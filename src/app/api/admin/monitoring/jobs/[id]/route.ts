import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  autoResolveConcernsForDisabledCheck,
  deleteJob,
  getJob,
  listJobOverrides,
  listRuns,
  replaceJobOverrides,
  updateJob,
  type JobCheckOverride,
} from "@/lib/db/monitoring-queries";
import {
  parseDepth,
  parseOverrides,
  parseTargetList,
} from "@/lib/monitoring/job-input";
import { nextRunAfter, normaliseSchedule } from "@/lib/monitoring/schedule";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    job,
    runs: await listRuns(id, 20),
    overrides: await listJobOverrides(id),
  });
}

export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const existing = await getJob(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let targets;
  let depth = existing.depth;
  let schedule = existing.schedule;
  let overrides: JobCheckOverride[] | undefined;
  try {
    depth = parseDepth(body.depth, existing.depth);
    // Validated against the NEW depth, and against the existing selection when
    // the request only changes depth: switching a 30-target job to deep has to be
    // refused rather than silently accepted and then never finishing.
    if (body.targets !== undefined || depth !== existing.depth)
      targets = parseTargetList(body.targets ?? existing.targets, depth);
    if (body.schedule !== undefined) schedule = normaliseSchedule(body.schedule);
    if (body.overrides !== undefined) overrides = parseOverrides(body.overrides);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid job" },
      { status: 400 },
    );
  }

  const enabled = body.enabled === undefined ? existing.enabled : body.enabled !== false;
  const job = await updateJob(
    id,
    {
      name:
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : existing.name,
      model:
        typeof body.model === "string" && body.model.trim()
          ? body.model.trim()
          : existing.model,
      depth,
      schedule,
      enabled,
      // Recompute from now whenever the schedule or the enabled flag moves, so
      // re-enabling a job never fires a burst of "missed" runs.
      nextRunAt: enabled ? nextRunAfter(schedule) : null,
    },
    targets,
  );
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });

  let autoResolved = 0;
  if (overrides) {
    // A check newly disabled for this job stops being evaluated, so its open
    // concerns must be closed here — reconciliation never touches a concern
    // whose check did not run, and nothing else would ever clear them.
    const before = new Set(
      (await listJobOverrides(id)).filter((o) => !o.enabled).map((o) => o.checkId),
    );
    await replaceJobOverrides(id, overrides);
    for (const override of overrides) {
      if (!override.enabled && !before.has(override.checkId))
        autoResolved += await autoResolveConcernsForDisabledCheck(
          override.checkId,
          id,
        );
    }
  }

  await writeAudit({
    actorId: actor.id,
    action: "monitoring.job.updated",
    metadata: {
      jobId: id,
      name: job.name,
      schedule,
      enabled,
      overrides: overrides?.length,
      autoResolved: autoResolved || undefined,
    },
  });
  return Response.json({ ...job, autoResolved });
}

export async function DELETE(_request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteJob(id);
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.job.deleted",
    metadata: { jobId: id, name: job.name, clusterId: job.clusterId },
  });
  return Response.json({ ok: true });
}
