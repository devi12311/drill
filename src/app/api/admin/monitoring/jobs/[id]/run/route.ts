import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  enqueueRun,
  getJob,
  getRun,
  hasActiveRun,
  reapStaleRuns,
} from "@/lib/db/monitoring-queries";
import { STALE_RUN_MS, executeRunNow } from "@/lib/monitoring/runner";

// An assessment is a full agentic investigation: tens of seconds to minutes.
// Same treatment as /api/chat, which runs at 900.
export const maxDuration = 900;

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Run a job now. Enqueues a run then drains it in the same request, so the
 * button gets a finished run back — the repo's existing pattern for long Holmes
 * calls (see /api/chat and conversations/[id]/resolve).
 *
 * If the browser walks away mid-flight the row stays `running` and the
 * scheduler tick's reaper fails it, rather than leaking a stuck run.
 */
export async function POST(_request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;

  const job = await getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  if (job.targets.length === 0)
    return Response.json(
      { error: "This job has no target workloads yet" },
      { status: 422 },
    );
  // Clear abandoned runs before the "already running" check. A browser that
  // walked away mid-run leaves the row `running`, and without this that job
  // could never be run again — the scheduler tick normally reaps, but it is not
  // deployed in v1.
  await reapStaleRuns(STALE_RUN_MS);
  if (await hasActiveRun(id))
    return Response.json(
      { error: "A run for this job is already queued or in progress" },
      { status: 409 },
    );

  const queued = await enqueueRun({
    jobId: id,
    trigger: "manual",
    triggeredBy: actor.id,
  });
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.run.triggered",
    metadata: { jobId: id, runId: queued.id, name: job.name },
  });

  await executeRunNow(queued.id);
  const run = await getRun(queued.id);
  return Response.json({ run: run ?? queued });
}
