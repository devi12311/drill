import {
  dueJobs,
  enqueueRun,
  hasActiveRun,
  reapStaleRuns,
  setNextRunAt,
  unmuteExpired,
} from "@/lib/db/monitoring-queries";
import { nextRunAfter } from "@/lib/monitoring/schedule";
import { checkSchedulerAuth } from "@/lib/monitoring/scheduler-auth";
import {
  STALE_RUN_MS,
  TICK_CONCURRENCY,
  drainQueue,
} from "@/lib/monitoring/runner";

// A tick may execute investigations inline; same budget as /api/chat.
export const maxDuration = 900;

/**
 * The scheduler entry point, called by a Kubernetes CronJob every minute.
 *
 * Kubernetes owns the timing, Postgres owns the queue: due jobs become `queued`
 * rows, and work is claimed with `FOR UPDATE SKIP LOCKED`, so two overlapping
 * ticks cannot run the same job twice. Scaling out later means pointing a worker
 * Deployment at the same table — this contract does not change.
 *
 * NOTE (v1): the CronJob is deliberately NOT shipped in the Helm chart yet.
 * This endpoint exists, is authenticated and is safe to curl by hand while
 * schedules and real per-run costs are being calibrated (docs/DECISIONS.md).
 */
export async function POST(request: Request) {
  const denied = checkSchedulerAuth(request);
  if (denied) return denied;

  const now = new Date();

  // 1. Crash recovery: a pod that died mid-run left the row `running`.
  const reaped = await reapStaleRuns(STALE_RUN_MS);

  // 2. Mute windows that have elapsed become visible again.
  const unmuted = await unmuteExpired();

  // 3. Enqueue what is due.
  const due = await dueJobs(now);
  let enqueued = 0;
  let skipped = 0;
  for (const job of due) {
    // Always advance the schedule first, so a job whose run is skipped or fails
    // cannot be re-enqueued on every subsequent tick.
    await setNextRunAt(job.id, nextRunAfter(job.schedule, now));
    // A slow investigation must never stack up behind itself.
    if (await hasActiveRun(job.id)) {
      skipped++;
      continue;
    }
    await enqueueRun({ jobId: job.id, trigger: "schedule", triggeredBy: null });
    enqueued++;
  }

  // 4. Execute a bounded slice; whatever is left waits for the next tick.
  const drained = await drainQueue(TICK_CONCURRENCY);

  return Response.json({
    at: now.toISOString(),
    reaped,
    unmuted,
    due: due.length,
    enqueued,
    skipped,
    executed: drained.executed,
    failed: drained.failed,
  });
}
