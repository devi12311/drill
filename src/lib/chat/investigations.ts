import { awaitsApproval, type TodoItem, type ToolCall } from "@/lib/holmes/types";
import { conversationCalls } from "@/lib/skills/conversation-steps";
import { parseDecisions, type DecisionView } from "./describe";
import type { ChatEntry } from "./types";

/**
 * A transcript is read as investigations: a question, then everything Holmes did
 * to answer it — including the approval pauses that split one investigation
 * across several stored messages. Client-safe; the chat pane groups with it.
 */

/** A tool call as it streams in: running until its result arrives. */
interface LiveToolCall {
  id: string;
  tool_name: string;
  toolCall?: ToolCall;
  /** A stored call's identity, which lets the skill builder pick it. */
  stepKey?: string;
}

/** Where an attempt began again inside one turn — drawn as a divider. */
export interface ResumeMark {
  kind: "resume";
  attempt: number;
  /** Plain-language reason the previous attempt stopped. */
  reason: string;
  callsBefore: number;
}

/** What a live turn's stream is made of. */
export type LiveItem = { kind: "call"; call: LiveToolCall } | ResumeMark;

/** Where the person answered an approval pause, in the call list. */
export interface ApprovalMark extends DecisionView {
  kind: "approval";
  id: string;
}

export type RailRow = LiveItem | ApprovalMark;

type InvestigationPart =
  | { kind: "answer"; entry: ChatEntry }
  | { kind: "decision"; entry: ChatEntry; decisions: DecisionView[] };

export interface Investigation {
  id: string;
  /** Null only for a transcript that (oddly) opens with an answer. */
  question: ChatEntry | null;
  parts: InvestigationPart[];
}

function pausedApprovals(entry: ChatEntry | undefined) {
  return entry?.role === "assistant" ? entry.response?.pending_approvals : undefined;
}

/**
 * Entries → investigations. A user line right after a paused answer that reads
 * as its decision ("Approved bash") continues that investigation.
 */
export function groupInvestigations(entries: readonly ChatEntry[]): Investigation[] {
  const out: Investigation[] = [];
  entries.forEach((entry, i) => {
    const decisions =
      entry.role === "user"
        ? parseDecisions(entry.ask ?? "", pausedApprovals(entries[i - 1]) ?? [])
        : null;
    if (entry.role === "user" && !decisions) {
      out.push({ id: entry.id, question: entry, parts: [] });
      return;
    }
    if (out.length === 0) out.push({ id: entry.id, question: null, parts: [] });
    out[out.length - 1].parts.push(
      decisions ? { kind: "decision", entry, decisions } : { kind: "answer", entry },
    );
  });
  return out;
}

type CallOutcome = "ok" | "failed" | "empty" | "awaiting";

/** Live statuses observed: success, error, no_data (empty but not failed), approval_required. */
export function callOutcome(call: ToolCall): CallOutcome {
  if (awaitsApproval(call)) return "awaiting";
  if (call.result.status === "error" || call.result.error !== null) return "failed";
  return call.result.status === "success" ? "ok" : "empty";
}

function todosOf(call: ToolCall | undefined): TodoItem[] | null {
  if (call?.tool_name !== "TodoWrite") return null;
  const todos = (call.result.params as { todos?: TodoItem[] } | null)?.todos;
  return todos?.length ? todos : null;
}

export interface InvestigationRows {
  /** The latest plan — each TodoWrite carries the full current list. */
  todos: TodoItem[] | null;
  /** Calls (TodoWrite excluded), resume dividers and approval marks, in order. */
  rows: RailRow[];
  calls: number;
  failed: number;
}

/**
 * One investigation's plan and calls, stored and live merged: a call paused for
 * approval shows once, with the result it got after the decision.
 */
export function investigationRows(
  inv: Investigation,
  live: readonly LiveItem[] = [],
): InvestigationRows {
  const liveCalls = live.flatMap((i) => (i.kind === "call" ? [i.call] : []));
  const answeredLive = new Set(
    liveCalls.flatMap((c) => (c.toolCall && !awaitsApproval(c.toolCall) ? [c.id] : [])),
  );
  const steps = conversationCalls(
    inv.parts.flatMap((p) =>
      p.kind === "answer"
        ? [{ id: p.entry.id, toolCalls: p.entry.response?.tool_calls ?? [] }]
        : [],
    ),
  ).filter((s) => !(awaitsApproval(s.call) && answeredLive.has(s.call.tool_call_id)));

  const rows: RailRow[] = [];
  for (const part of inv.parts) {
    if (part.kind === "decision") {
      part.decisions.forEach((d, i) =>
        rows.push({ kind: "approval", id: `${part.entry.id}:${i}`, ...d }),
      );
      continue;
    }
    for (const step of steps)
      if (step.messageId === part.entry.id && step.call.tool_name !== "TodoWrite")
        rows.push({
          kind: "call",
          call: {
            id: step.key,
            tool_name: step.call.tool_name,
            toolCall: step.call,
            stepKey: step.key,
          },
        });
  }
  for (const item of live)
    if (item.kind === "resume" || item.call.tool_name !== "TodoWrite") rows.push(item);

  let todos: TodoItem[] | null = null;
  for (const call of [...steps.map((s) => s.call), ...liveCalls.map((c) => c.toolCall)])
    todos = todosOf(call) ?? todos;

  const callRows = rows.flatMap((r) => (r.kind === "call" ? [r.call] : []));
  return {
    todos,
    rows,
    calls: callRows.length,
    failed: callRows.filter((c) => c.toolCall && callOutcome(c.toolCall) === "failed").length,
  };
}

/** Cost, tokens and time over every answer the investigation took. */
export function investigationCost(inv: Investigation) {
  let cost: number | null = null;
  let tokens: number | null = null;
  let ms: number | null = null;
  let model: string | undefined;
  for (const part of inv.parts) {
    if (part.kind !== "answer") continue;
    const { response } = part.entry;
    const meta = response?.metadata;
    if (meta?.costs?.total_cost != null) cost = (cost ?? 0) + meta.costs.total_cost;
    if (meta?.usage?.total_tokens != null) tokens = (tokens ?? 0) + meta.usage.total_tokens;
    if (response?.drill_duration_ms != null) ms = (ms ?? 0) + response.drill_duration_ms;
    model = part.entry.model ?? model;
  }
  return { cost, tokens, ms, model };
}
