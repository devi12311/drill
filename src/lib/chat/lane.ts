import "server-only";
import { listen } from "@/lib/db";
import {
  CHAT_TURN_CHANNEL,
  claimQueuedTurns,
  type ClaimedTurn,
} from "@/lib/db/chat-turn-queries";
import type { Lane } from "@/lib/worker/lane";
import { executeClaimedTurn, reapTurns } from "./runner";

/**
 * Chat turns in parallel, unlike monitoring's one at a time: a person is waiting on
 * each, and one deep question must not hold up everyone else's. The limit is
 * there because concurrent agentic investigations share one LLM rate limit
 * (Holmes surfaces hitting it as SSE error_code 5204).
 */
function chatConcurrency(): number {
  const n = Number.parseInt(process.env.CHAT_CONCURRENCY ?? "", 10);
  return Number.isFinite(n) && n >= 1 ? n : 3;
}

export const chatLane: Lane<ClaimedTurn> = {
  name: "chat",
  concurrency: chatConcurrency(),
  // A person just pressed Send: LISTEN wakes the lane at once; this is the fallback.
  pollMs: 2_000,
  housekeepingMs: 15_000,
  claim: claimQueuedTurns,
  execute: executeClaimedTurn,
  housekeeping: reapTurns,
  subscribe: (wake) => listen(CHAT_TURN_CHANNEL, wake),
};
