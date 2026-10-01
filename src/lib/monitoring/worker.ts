import "server-only";
import { claimQueuedRuns, unmuteExpired } from "@/lib/db/monitoring-queries";
import type { Lane } from "@/lib/worker/lane";
import { executeClaimedRun, reapStaleRuns } from "./runner";

/**
 * The monitoring lane of the worker (lib/worker): turns a queued run into concerns.
 *
 * A deep run is hours of held Holmes streams, which is why runs never execute in a
 * web request (docs/DECISIONS.md 105). One run at a time per worker — concurrent
 * agentic investigations hit LLM rate limits (Holmes surfaces those as SSE
 * error_code 5204). More throughput means more replicas, which `FOR UPDATE SKIP
 * LOCKED` already makes safe.
 */
export const monitoringLane: Lane<{ id: string; jobId: string }> = {
  name: "monitoring",
  concurrency: 1,
  pollMs: 3_000,
  // Reaping dead runs and expiring mutes; neither is urgent to the second.
  housekeepingMs: 60_000,
  claim: claimQueuedRuns,
  execute: executeClaimedRun,
  housekeeping: async () => {
    await reapStaleRuns();
    await unmuteExpired();
  },
};
