import "server-only";
import { and, asc, eq, gt, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db, notify, type DbExecutor } from "./index";
import { addAssistantMessage, addUserMessage } from "./queries";
import { chatTurnEvents, chatTurns } from "./schema";
import {
  ACTIVE_TURN_STATUSES,
  type TurnEvent,
  type TurnSnapshot,
  type TurnStatus,
} from "@/lib/chat/types";
import type {
  HolmesChatRequest,
  HolmesChatResponse,
  ToolCall,
} from "@/lib/holmes/types";

/**
 * Chat turns: the queue the worker's chat lane executes, and the progress every
 * viewer replays. Mirrors `monitoring_runs` (claim with SKIP LOCKED, heartbeat that
 * doubles as the cancel check, guarded finalizers), with one addition: `attempt` is
 * a fencing token. A worker only writes a terminal state for the attempt it
 * claimed, so one presumed dead and reaped cannot overwrite its successor.
 */

/** Wakes the chat lane; sent after every write that leaves a turn `queued`. */
export const CHAT_TURN_CHANNEL = "drill_chat_turn";

const ERROR_LIMIT = 2_000;

function clip(error: string): string {
  return error.length > ERROR_LIMIT ? `${error.slice(0, ERROR_LIMIT)}…` : error;
}

const snapshotColumns = {
  id: chatTurns.id,
  status: chatTurns.status,
  attempt: chatTurns.attempt,
  error: chatTurns.error,
  resumable: chatTurns.resumable,
  createdAt: chatTurns.createdAt,
  startedAt: chatTurns.startedAt,
};

function toSnapshot(row: {
  id: string;
  status: TurnStatus;
  attempt: number;
  error: string | null;
  resumable: boolean;
  createdAt: Date;
  startedAt: Date | null;
}): TurnSnapshot {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
  };
}

// ---- Web side (user-scoped) ----

/** The conversation's open turn, if any — what a reload reattaches to. */
export async function getOpenTurn(
  conversationId: string,
): Promise<TurnSnapshot | null> {
  const [row] = await db
    .select(snapshotColumns)
    .from(chatTurns)
    .where(eq(chatTurns.conversationId, conversationId));
  return row ? toSnapshot(row) : null;
}

export async function getTurnSnapshot(
  userId: string,
  turnId: string,
): Promise<TurnSnapshot | null> {
  const [row] = await db
    .select(snapshotColumns)
    .from(chatTurns)
    .where(and(eq(chatTurns.id, turnId), eq(chatTurns.userId, userId)));
  return row ? toSnapshot(row) : null;
}

export async function turnEventsAfter(
  turnId: string,
  afterSeq: number,
  limit = 200,
) {
  return db
    .select({
      seq: chatTurnEvents.seq,
      payload: chatTurnEvents.payload,
      createdAt: chatTurnEvents.createdAt,
    })
    .from(chatTurnEvents)
    .where(and(eq(chatTurnEvents.turnId, turnId), gt(chatTurnEvents.seq, afterSeq)))
    .orderBy(asc(chatTurnEvents.seq))
    .limit(limit);
}

/** Every tool call a turn has made so far, across all its attempts, in order. */
export async function turnToolCalls(
  turnId: string,
  tx: DbExecutor = db,
): Promise<ToolCall[]> {
  const rows = await tx
    .select({ payload: chatTurnEvents.payload })
    .from(chatTurnEvents)
    .where(
      and(eq(chatTurnEvents.turnId, turnId), eq(chatTurnEvents.type, "tool_result")),
    )
    .orderBy(asc(chatTurnEvents.seq));
  return rows.flatMap((r) =>
    r.payload.type === "tool_result" ? [r.payload.toolCall] : [],
  );
}

/**
 * Close a stopped turn into the transcript: its partial tool calls and its error
 * become an assistant message (no history, so replay skips it), then the turn is
 * deleted. Nothing the investigation gathered is lost by moving on.
 */
async function dismissInTx(
  tx: DbExecutor,
  turn: {
    id: string;
    conversationId: string;
    model: string;
    error: string | null;
    status: TurnStatus;
    startedAt: Date | null;
    createdAt: Date;
  },
): Promise<void> {
  const response: HolmesChatResponse = {
    analysis: "",
    conversation_history: [],
    tool_calls: await turnToolCalls(turn.id, tx),
    follow_up_actions: null,
    pending_approvals: null,
    drill_error:
      turn.error ??
      (turn.status === "cancelled" ? "Stopped" : "The investigation stopped"),
  };
  await addAssistantMessage(
    {
      conversationId: turn.conversationId,
      response,
      model: turn.model,
      durationMs: Date.now() - (turn.startedAt ?? turn.createdAt).getTime(),
    },
    tx,
  );
  await tx.delete(chatTurns).where(eq(chatTurns.id, turn.id));
}

export type OpenTurnResult =
  | { ok: true; turnId: string }
  | { ok: false; activeTurnId: string };

/**
 * Queue a new turn: the user's line goes into the transcript and the turn into the
 * chat lane's queue in ONE transaction, so a refused send leaves no orphan
 * question. A stopped turn still open in the conversation is dismissed first.
 */
export async function openTurn(input: {
  conversationId: string;
  userId: string;
  agentId: string;
  model: string;
  kind: "ask" | "decision";
  request: HolmesChatRequest;
  question: string;
  note?: string;
  userLine: string;
}): Promise<OpenTurnResult> {
  try {
    const result = await db.transaction(async (tx): Promise<OpenTurnResult> => {
      const [existing] = await tx
        .select()
        .from(chatTurns)
        .where(eq(chatTurns.conversationId, input.conversationId))
        .for("update");
      if (existing) {
        if ((ACTIVE_TURN_STATUSES as readonly string[]).includes(existing.status))
          return { ok: false, activeTurnId: existing.id };
        await dismissInTx(tx, existing);
      }
      await addUserMessage(input.conversationId, input.userLine, tx);
      const [turn] = await tx
        .insert(chatTurns)
        .values({
          conversationId: input.conversationId,
          userId: input.userId,
          agentId: input.agentId,
          model: input.model,
          kind: input.kind,
          request: input.request,
          question: input.question,
          note: input.note,
        })
        .returning({ id: chatTurns.id });
      return { ok: true, turnId: turn.id };
    });
    // Only a wake-up — the lane polls anyway — so it must never fail a turn that
    // is already committed.
    if (result.ok) await notify(CHAT_TURN_CHANNEL).catch(() => null);
    return result;
  } catch (err) {
    // Two sends racing past the row lock (neither saw the other's insert): the
    // unique index decides, and the loser attaches to the winner.
    if ((err as { code?: string }).code === "23505") {
      const open = await getOpenTurn(input.conversationId);
      if (open) return { ok: false, activeTurnId: open.id };
    }
    throw err;
  }
}

/** "dismissed", or why not: the turn is still running / does not exist. */
export async function dismissTurn(
  userId: string,
  turnId: string,
): Promise<"dismissed" | "active" | "missing"> {
  return db.transaction(async (tx) => {
    const [turn] = await tx
      .select()
      .from(chatTurns)
      .where(and(eq(chatTurns.id, turnId), eq(chatTurns.userId, userId)))
      .for("update");
    if (!turn) return "missing";
    if ((ACTIVE_TURN_STATUSES as readonly string[]).includes(turn.status))
      return "active";
    await dismissInTx(tx, turn);
    return "dismissed";
  });
}

/**
 * Stop a turn. A queued one has cost nothing and is closed on the spot; a running
 * one is only flagged, because the worker holding its Holmes stream is the one
 * that has to abort it — exactly as monitoring's `requestCancel`.
 */
export async function requestTurnCancel(
  userId: string,
  turnId: string,
): Promise<"cancelled" | "requested" | "inactive"> {
  const owned = and(eq(chatTurns.id, turnId), eq(chatTurns.userId, userId));
  const now = new Date();
  const [queued] = await db
    .update(chatTurns)
    .set({
      status: "cancelled",
      cancelRequestedAt: now,
      finishedAt: now,
      error: "Stopped before it started",
    })
    .where(and(owned, eq(chatTurns.status, "queued")))
    .returning({ id: chatTurns.id });
  if (queued) return "cancelled";
  const [running] = await db
    .update(chatTurns)
    .set({
      cancelRequestedAt: sql`coalesce(${chatTurns.cancelRequestedAt}, now())`,
    })
    .where(and(owned, eq(chatTurns.status, "running")))
    .returning({ id: chatTurns.id });
  return running ? "requested" : "inactive";
}

/** A manual Resume: no attempt budget applies — the user asked for it. */
export async function resumeTurn(
  userId: string,
  turnId: string,
): Promise<boolean> {
  const [row] = await db
    .update(chatTurns)
    .set({ status: "queued", cancelRequestedAt: null, finishedAt: null })
    .where(
      and(
        eq(chatTurns.id, turnId),
        eq(chatTurns.userId, userId),
        inArray(chatTurns.status, ["failed", "cancelled"]),
        eq(chatTurns.resumable, true),
      ),
    )
    .returning({ id: chatTurns.id });
  if (row) await notify(CHAT_TURN_CHANNEL).catch(() => null);
  return !!row;
}

// ---- Worker side ----

export interface ClaimedTurn {
  id: string;
  conversationId: string;
  agentId: string;
  userId: string;
  model: string;
  kind: "ask" | "decision";
  request: HolmesChatRequest;
  question: string;
  note: string | null;
  attempt: number;
  autoResumes: number;
  startedAt: Date;
  /** Why the previous attempt stopped — becomes the resume divider's reason. */
  previousError: string | null;
}

export async function claimQueuedTurns(limit: number): Promise<ClaimedTurn[]> {
  // The CTE keeps the pre-update error: RETURNING only sees the new row, and the
  // claim clears `error` so a running turn never shows a stale one.
  const rows = (await db.execute(sql`
    with picked as (
      select id, error from ${chatTurns}
      where status = 'queued'
      order by created_at
      limit ${limit}
      for update skip locked
    )
    update ${chatTurns} t set
      status = 'running',
      claimed_at = now(),
      heartbeat_at = now(),
      started_at = coalesce(t.started_at, now()),
      attempt = t.attempt + 1,
      error = null
    from picked
    where t.id = picked.id
    returning t.id, t.conversation_id, t.agent_id, t.user_id, t.model, t.kind,
      t.request, t.question, t.note, t.attempt, t.auto_resumes,
      -- As epoch ms: raw execute skips Drizzle's column mappers, and a bare
      -- timestamp string would be parsed in the process's local zone, not UTC.
      extract(epoch from t.started_at) * 1000 as started_ms,
      picked.error as previous_error
  `)) as unknown as {
    id: string;
    conversation_id: string;
    agent_id: string;
    user_id: string;
    model: string;
    kind: "ask" | "decision";
    request: HolmesChatRequest;
    question: string;
    note: string | null;
    attempt: number;
    auto_resumes: number;
    started_ms: string | number;
    previous_error: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    agentId: r.agent_id,
    userId: r.user_id,
    model: r.model,
    kind: r.kind,
    request: r.request,
    question: r.question,
    note: r.note,
    attempt: r.attempt,
    autoResumes: r.auto_resumes,
    startedAt: new Date(Number(r.started_ms)),
    previousError: r.previous_error,
  }));
}

/** The claim this worker holds: the turn, at the attempt it claimed, still running. */
function held(turnId: string, attempt: number) {
  return and(
    eq(chatTurns.id, turnId),
    eq(chatTurns.attempt, attempt),
    eq(chatTurns.status, "running"),
  );
}

/**
 * Liveness write + cancel check. Null when this worker no longer holds the turn —
 * it was reaped, deleted with its conversation, or claimed again by someone else.
 */
export async function heartbeatTurn(
  turnId: string,
  attempt: number,
): Promise<{ cancelRequested: boolean } | null> {
  const [row] = await db
    .update(chatTurns)
    .set({ heartbeatAt: new Date() })
    .where(held(turnId, attempt))
    .returning({ cancelRequestedAt: chatTurns.cancelRequestedAt });
  return row ? { cancelRequested: row.cancelRequestedAt !== null } : null;
}

export async function appendTurnEvent(
  turnId: string,
  attempt: number,
  event: TurnEvent,
): Promise<void> {
  await db
    .insert(chatTurnEvents)
    .values({ turnId, attempt, type: event.type, payload: event });
}

/**
 * The answer (or approval pause) is in: write it to the transcript and delete the
 * turn, atomically. False when the claim was lost meanwhile — then nothing is
 * written, because whoever holds the turn now will write it.
 */
export async function completeTurn(
  turnId: string,
  attempt: number,
  message: Parameters<typeof addAssistantMessage>[0],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(chatTurns)
      .where(held(turnId, attempt))
      .returning({ id: chatTurns.id });
    if (deleted.length === 0) return false;
    await addAssistantMessage(message, tx);
    return true;
  });
}

/** Leave the turn for the user to Resume or Dismiss. */
export async function stopTurn(
  turnId: string,
  attempt: number,
  outcome: { status: "failed" | "cancelled"; error: string; resumable: boolean },
): Promise<void> {
  await db
    .update(chatTurns)
    .set({
      status: outcome.status,
      error: clip(outcome.error),
      resumable: outcome.resumable,
      finishedAt: new Date(),
    })
    .where(held(turnId, attempt));
}

/** Put the turn back in the queue to be resumed; `spendAutoResume` for dropped calls. */
export async function requeueTurn(
  turnId: string,
  attempt: number,
  error: string,
  spendAutoResume: boolean,
): Promise<void> {
  const [row] = await db
    .update(chatTurns)
    .set({
      status: "queued",
      error: clip(error),
      ...(spendAutoResume && {
        autoResumes: sql`${chatTurns.autoResumes} + 1`,
      }),
    })
    .where(held(turnId, attempt))
    .returning({ id: chatTurns.id });
  if (row) await notify(CHAT_TURN_CHANNEL).catch(() => null);
}

/**
 * Crash recovery for every running turn whose worker went quiet. Requeued rather
 * than failed — the call died with Drill's worker, not with Holmes — unless it has
 * already used `maxAttempts`, which stops a turn that kills its worker each time
 * from looping. The stale condition is part of each write, so a turn whose worker
 * beat in the meantime is left alone.
 */
export async function reapStaleTurns(
  quietMs: number,
  maxAttempts: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - quietMs);
  const stale = and(
    eq(chatTurns.status, "running"),
    or(
      lt(chatTurns.heartbeatAt, cutoff),
      and(isNull(chatTurns.heartbeatAt), lt(chatTurns.claimedAt, cutoff)),
    ),
  );
  const lost =
    "The worker running this stopped responding (it crashed or was killed)";
  const failed = await db
    .update(chatTurns)
    .set({ status: "failed", error: lost, finishedAt: new Date() })
    .where(and(stale, gte(chatTurns.attempt, maxAttempts)))
    .returning({ id: chatTurns.id });
  const requeued = await db
    .update(chatTurns)
    .set({ status: "queued", error: lost })
    .where(stale)
    .returning({ id: chatTurns.id });
  if (requeued.length) await notify(CHAT_TURN_CHANNEL).catch(() => null);
  return failed.length + requeued.length;
}
