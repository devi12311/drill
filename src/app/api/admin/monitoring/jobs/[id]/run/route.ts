import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { monitoringNotFound, ownsMonitoring } from "@/lib/monitoring/access";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  enqueueRun,
  getJob,
  hasActiveRun,
} from "@/lib/db/monitoring-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Run a job now: enqueue it and return `202` with the queued run. That is all.
 *
 * The investigation is executed by the monitoring lane of the worker (lib/monitoring/worker.ts),
 * never by this request or this process — a deep run outlives any request budget,
 * and running it in the web server meant a UI deploy killed it. The page learns
 * about progress by polling the run, not by waiting here.
 */
export async function POST(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const { id } = await context.params;
  if (!(await ownsMonitoring(ctx, { job: id }))) return monitoringNotFound();

  const job = await getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  if (job.targets.length === 0)
    return Response.json(
      { error: "This job has no target workloads yet" },
      { status: 422 },
    );
  // A run whose worker died is closed by the worker's reaper within a couple of
  // minutes (it watches heartbeats), so this refusal is never a long lockout.
  if (await hasActiveRun(id))
    return Response.json(
      { error: "A run for this job is already queued or in progress" },
      { status: 409 },
    );

  const queued = await enqueueRun({
    jobId: id,
    trigger: "manual",
    triggeredBy: ctx.userId,
  });
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "monitoring.run.triggered",
    metadata: { jobId: id, runId: queued.id, name: job.name },
  });

  return Response.json({ run: queued }, { status: 202 });
}
