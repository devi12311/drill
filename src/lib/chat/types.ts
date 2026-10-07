import type { HolmesChatResponse, ToolCall } from "@/lib/holmes/types";
import type { MessageSkill } from "@/lib/skills/types";

/**
 * A chat turn's lifecycle. There is no `succeeded`: a turn that answers is written
 * to `messages` and deleted in the same transaction, so any row that exists is
 * either still in flight or waiting for the user to Resume or Dismiss it.
 */
export const TURN_STATUSES = ["queued", "running", "failed", "cancelled"] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

export const ACTIVE_TURN_STATUSES = ["queued", "running"] as const satisfies readonly TurnStatus[];

export function isActiveTurn(status: TurnStatus): boolean {
  return (ACTIVE_TURN_STATUSES as readonly TurnStatus[]).includes(status);
}

/**
 * What a turn's progress is made of, saved in `chat_turn_events` as it happens and
 * replayed verbatim to every viewer — so a reload shows exactly what was live.
 * `attempt_started` marks where a resume began; `reason` is why the previous attempt
 * stopped.
 */
export type TurnEvent =
  | { type: "tool_start"; id: string; tool_name: string }
  | { type: "tool_result"; toolCall: ToolCall }
  | { type: "ai_message"; content: string }
  | { type: "attempt_started"; attempt: number; reason?: string };

/** The turn as the client sees it — never the stored request (it holds history). */
export interface TurnSnapshot {
  id: string;
  status: TurnStatus;
  attempt: number;
  error: string | null;
  resumable: boolean;
  createdAt: string;
  startedAt: string | null;
}

/** What the turn stream (`GET /api/chat/turns/[id]/events`) sends, one per `data:` frame. */
export type TurnStreamMessage =
  | { type: "turn"; turn: TurnSnapshot; serverNow: number }
  | { type: "event"; seq: number; at: number; event: TurnEvent }
  /** The turn row is gone: it answered (or was dismissed). Messages hold the result. */
  | { type: "settled" };

/** One sidebar dot per conversation (`listConversations`). */
export type ConversationActivity = TurnStatus | "awaiting_approval" | null;

/** One Recent row: what the sidebar lists for the active agent. */
export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  status: "open" | "resolved";
  artifactId: string | null;
  updatedAt: string;
  activity: ConversationActivity;
}

export function isInvestigating(conv: Pick<ConversationSummary, "activity">): boolean {
  return conv.activity === "queued" || conv.activity === "running";
}

/** One transcript line as the chat pane renders it (a stored message, or an optimistic one). */
export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  /** user entries */
  ask?: string;
  /** user entries: the skill the line ran explicitly */
  skill?: MessageSkill;
  /** assistant entries */
  response?: HolmesChatResponse & { drill_duration_ms?: number };
  error?: string;
  model?: string;
}
