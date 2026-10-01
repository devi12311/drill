import {
  dueJobs,
  enqueueRun,
  hasActiveRun,
  setNextRunAt,
  unmuteExpired,
} from "@/lib/db/monitoring-queries";
import { nextRunAfter } from "@/lib/monitoring/schedule";
import { reapStaleRuns } from "@/lib/monitoring/runner";
import { checkSchedulerAuth } from "@/lib/monitoring/scheduler-auth";

/**
 * The scheduler entry point, called by a Kubernetes CronJob every minute.
 *
 * Kubernetes owns the timing, Postgres owns the queue: due jobs become `queued`
 * rows and the monitoring worker executes them. This request never runs an
 * investigation itself — it used to drain the queue inline, which put an hours-long
 * deep run inside a CronJob's HTTP call.
 *
 * NOTE (v1): the CronJob is deliberately NOT shipped in the Helm chart yet.
 * This endpoint exists, is authenticated and is safe to curl by hand while
 * schedules and real per-run costs are being calibrated (docs/DECISIONS.md).
 */
export async function POST(request: Request) {
  const denied = checkSchedulerAuth(request);
  if (denied) return denied;

  const now = new Date();

  // 1. Crash recovery: a worker that died mid-run left the row `running`. The
  // worker reaps too; doing it here as well costs nothing and is race-safe.
  const reaped = await reapStaleRuns();

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

  return Response.json({
    at: now.toISOString(),
    reaped,
    unmuted,
    due: due.length,
    enqueued,
    skipped,
  });
}
