import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  createJob,
  getClusterSummary,
  replaceJobOverrides,
} from "@/lib/db/monitoring-queries";
import { DEFAULT_MODEL } from "@/lib/holmes/types";
import { nextRunAfter, normaliseSchedule } from "@/lib/monitoring/schedule";
import {
  parseDepth,
  parseOverrides,
  parseTargetList,
} from "@/lib/monitoring/job-input";
import { MONITOR_CATEGORIES, type MonitorCategory } from "@/lib/monitoring/types";

export async function POST(request: Request) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const clusterId = typeof body.clusterId === "string" ? body.clusterId : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const type = typeof body.type === "string" ? body.type : "";
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : DEFAULT_MODEL;
  const enabled = body.enabled !== false;

  if (!clusterId || !name)
    return Response.json(
      { error: "clusterId and name are required" },
      { status: 400 },
    );
  if (!(MONITOR_CATEGORIES as readonly string[]).includes(type))
    return Response.json(
      { error: `type must be one of: ${MONITOR_CATEGORIES.join(", ")}` },
      { status: 400 },
    );
  if (!(await getClusterSummary(clusterId)))
    return Response.json({ error: "Cluster not found" }, { status: 404 });

  let targets;
  let depth;
  let schedule: string | null;
  let overrides;
  try {
    // Depth first: it decides how many targets the job is allowed to have.
    depth = parseDepth(body.depth);
    targets = parseTargetList(body.targets, depth);
    schedule = normaliseSchedule(body.schedule);
    overrides = parseOverrides(body.overrides);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid job" },
      { status: 400 },
    );
  }

  const job = await createJob(
    {
      clusterId,
      name,
      type: type as MonitorCategory,
      depth,
      model,
      schedule,
      enabled,
      nextRunAt: enabled ? nextRunAfter(schedule) : null,
      createdBy: actor.id,
    },
    targets,
  );
  if (overrides.length > 0) await replaceJobOverrides(job.id, overrides);
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.job.created",
    metadata: {
      jobId: job.id,
      clusterId,
      name,
      type,
      depth,
      targets: targets.length,
      schedule,
      overrides: overrides.length || undefined,
    },
  });
  return Response.json(job, { status: 201 });
}
