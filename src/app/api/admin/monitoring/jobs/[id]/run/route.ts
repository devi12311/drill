import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  enqueueRun,
  getJob,
  hasActiveRun,
  reapStaleRuns,
} from "@/lib/db/monitoring-queries";
import { STALE_RUN_MS, executeRunNow } from "@/lib/monitoring/runner";

// Kept for the enqueue path itself, which is fast. The investigation deliberately
// does NOT run inside this request any more — see the handler.
export const maxDuration = 900;

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Run a job now: enqueue, start executing, and return IMMEDIATELY with the queued
 * run. The client polls the job's run list for the result.
 *
 * This replaces awaiting the investigation inside the request (the original
 * behaviour, and the pattern /api/chat still uses). A deep run is one full
 * investigation per workload with a 20-minute allowance each, so it routinely
 * outlives any HTTP request budget — awaiting it meant the browser saw a network
 * error while the run was still healthy and, worse, invited a client-side retry
 * against work that was already being paid for.
 *
 * The floating promise is deliberate and is not a new failure mode: `executeRunNow`
 * already guards every throw into `failRun`, and a process that dies mid-run leaves
 * the row `running` for the reaper — exactly what happened before when the browser
 * walked away.
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

  // Not awaited: see the note above. `.catch` only guards against an unforeseen
  // throw escaping the runner's own guard — it must never reject unhandled here,
  // because there is no request left to attribute the error to.
  void executeRunNow(queued.id).catch(() => null);

  return Response.json({ run: queued }, { status: 202 });
}
