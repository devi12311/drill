import "server-only";
import {
  appendTurnEvent,
  completeTurn,
  heartbeatTurn,
  reapStaleTurns,
  requeueTurn,
  stopTurn,
  turnToolCalls,
  type ClaimedTurn,
} from "@/lib/db/chat-turn-queries";
import { getAgent, resumeContext } from "@/lib/db/queries";
import { HolmesConnectionError } from "@/lib/holmes/sse";
import { streamHolmes, type StreamOutcome } from "@/lib/holmes/stream";
import type { HolmesChatRequest } from "@/lib/holmes/types";
import { buildResumeRequest } from "./resume";

/**
 * Executes chat turns — the chat lane of the worker (lib/worker). The
 * counterpart of lib/monitoring/runner.ts for interactive questions, and built the
 * same way: claim, hold with a heartbeat that is also the cancel channel, and
 * close with a write guarded on the claim. Every event is saved the moment it
 * arrives, which is what lets a viewer reattach and a dropped turn resume.
 */

/** Chat is watched live, so Stop has to land within seconds, not monitoring's 20s. */
const HEARTBEAT_MS = 5_000;
/** Silence after which a turn's worker is presumed dead. */
export const STALE_TURN_MS = 45_000;
/**
 * Claims a turn may use before requeues stop being automatic. Bounds a turn that
 * takes its worker down every time; a manual Resume is not counted against it.
 */
export const MAX_AUTO_ATTEMPTS = 5;
/** Dropped connections resumed without asking. The user chose once. */
const AUTO_RESUMES = 1;

type Interruption = "cancel" | "shutdown" | "lost";

/** The abort reason handed to the stream, which rethrows it untouched. */
class TurnInterrupted extends Error {
  constructor(readonly why: Interruption) {
    super(why);
  }
}

/**
 * The request this attempt sends. The first attempt sends the stored request as
 * is. A later one sends it again only when nothing ran yet and it was a plain
 * question; otherwise it is rebuilt from the saved evidence (lib/chat/resume.ts).
 * A decision is never re-sent: that would replay an approval, and with it a
 * command the user allowed once.
 */
async function requestFor(turn: ClaimedTurn): Promise<HolmesChatRequest> {
  if (turn.attempt === 1) return turn.request;
  const own = await turnToolCalls(turn.id);
  if (turn.kind === "ask" && own.length === 0) return turn.request;
  const context = await resumeContext(turn.conversationId);
  return buildResumeRequest({
    original: turn.request,
    question: turn.question,
    decisionNote: turn.note,
    toolCalls: [...context.priorToolCalls, ...own],
    history: context.history,
  });
}

export async function executeClaimedTurn(
  turn: ClaimedTurn,
  shutdown: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const stop = (why: Interruption) => {
    if (!controller.signal.aborted) controller.abort(new TurnInterrupted(why));
  };
  const onShutdown = () => stop("shutdown");
  shutdown.addEventListener("abort", onShutdown, { once: true });
  const heartbeat = setInterval(() => {
    heartbeatTurn(turn.id, turn.attempt)
      .then((beat) => {
        if (!beat) stop("lost");
        else if (beat.cancelRequested) stop("cancel");
      })
      // A missed beat is not fatal; enough of them and the reaper decides.
      .catch(() => null);
  }, HEARTBEAT_MS);

  try {
    // A Stop pressed between the claim and the first beat must not be missed.
    const first = await heartbeatTurn(turn.id, turn.attempt);
    if (!first) return;
    if (first.cancelRequested) stop("cancel");

    const agent = await getAgent(turn.scope.orgId, turn.agentId);
    if (!agent) {
      await stopTurn(turn.id, turn.attempt, {
        status: "failed",
        error: "The Holmes agent for this conversation was deleted",
        resumable: false,
      });
      return;
    }
    if (turn.attempt > 1) {
      await appendTurnEvent(turn.id, turn.attempt, {
        type: "attempt_started",
        attempt: turn.attempt,
        ...(turn.previousError && { reason: turn.previousError }),
      });
    }

    const request = await requestFor(turn);
    const outcome: StreamOutcome = { response: null! };
    for await (const event of streamHolmes(
      request,
      outcome,
      { url: agent.url, apiKey: agent.apiKey },
      turn.scope,
      controller.signal,
    )) {
      // `done` is not progress: the answer goes to `messages`, below.
      if (event.type === "done") continue;
      await appendTurnEvent(turn.id, turn.attempt, event);
    }
    if (!outcome.response) throw new Error("Holmes ended without an answer");

    // The transcript shows the whole turn, every attempt included — the saved
    // events are the one complete record of what ran.
    const response = {
      ...outcome.response,
      tool_calls: await turnToolCalls(turn.id),
      ...(outcome.response.pending_approvals?.length
        ? { drill_question: turn.question }
        : {}),
    };
    await completeTurn(turn.id, turn.attempt, {
      conversationId: turn.conversationId,
      response,
      model: turn.model,
      durationMs: Date.now() - turn.startedAt.getTime(),
    });
  } catch (err) {
    await settleFailure(turn, err, controller.signal).catch((writeErr) =>
      console.error("[drill chat] could not record a failed turn", writeErr),
    );
  } finally {
    clearInterval(heartbeat);
    shutdown.removeEventListener("abort", onShutdown);
  }
}

/** Decide what a turn that threw becomes: resumed now, or left for the user. */
async function settleFailure(
  turn: ClaimedTurn,
  err: unknown,
  signal: AbortSignal,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  if (signal.aborted && signal.reason instanceof TurnInterrupted) {
    const why = signal.reason.why;
    if (why === "lost") return;
    if (why === "cancel") {
      await stopTurn(turn.id, turn.attempt, {
        status: "cancelled",
        error: "Stopped",
        resumable: true,
      });
      return;
    }
    // Shutdown: Drill hung up on Holmes itself, so the next worker picks it up.
    const error = "The worker restarted mid-investigation";
    if (turn.attempt < MAX_AUTO_ATTEMPTS)
      return requeueTurn(turn.id, turn.attempt, error, false);
    return stopTurn(turn.id, turn.attempt, { status: "failed", error, resumable: true });
  }
  if (err instanceof HolmesConnectionError && turn.autoResumes < AUTO_RESUMES) {
    await requeueTurn(turn.id, turn.attempt, message, true);
    return;
  }
  await stopTurn(turn.id, turn.attempt, {
    status: "failed",
    error: message,
    resumable: true,
  });
}

/** Chat-lane housekeeping: requeue (or, past the cap, fail) turns whose worker died. */
export function reapTurns(): Promise<number> {
  return reapStaleTurns(STALE_TURN_MS, MAX_AUTO_ATTEMPTS);
}
