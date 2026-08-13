import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  deleteCluster,
  getClusterSecrets,
  getClusterSummary,
  listJobs,
  listWorkloads,
  updateCluster,
} from "@/lib/db/monitoring-queries";
import { discoverWorkloads } from "@/lib/monitoring/discovery";
import { validateAgent } from "@/lib/holmes/validate";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const cluster = await getClusterSummary(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    cluster,
    workloads: await listWorkloads(id),
    jobs: await listJobs(id),
  });
}

/**
 * Update a cluster. Secrets are write-only: omitting `kubeconfig` or
 * `holmesApiKey` keeps the stored value (same convention as
 * `PATCH /api/agents/[id]`). Whichever credential is supplied is re-validated.
 */
export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const existing = await getClusterSecrets(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  let body: {
    name?: string;
    kubeconfig?: string;
    holmesUrl?: string;
    holmesApiKey?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim() || existing.name;
  const kubeconfig = body.kubeconfig?.trim() || existing.kubeconfig;
  const holmesUrl =
    body.holmesUrl?.trim().replace(/\/$/, "") || existing.holmesUrl;
  const holmesApiKey = body.holmesApiKey?.trim() || existing.holmesApiKey;
  if (!/^https?:\/\//.test(holmesUrl)) {
    return Response.json(
      { error: "holmesUrl must start with http:// or https://" },
      { status: 400 },
    );
  }

  if (kubeconfig !== existing.kubeconfig) {
    try {
      await discoverWorkloads(kubeconfig);
    } catch (err) {
      return Response.json(
        {
          error: err instanceof Error ? err.message : "Kubeconfig validation failed",
          field: "kubeconfig",
        },
        { status: 422 },
      );
    }
  }
  if (holmesUrl !== existing.holmesUrl || holmesApiKey !== existing.holmesApiKey) {
    try {
      await validateAgent(holmesUrl, holmesApiKey);
    } catch (err) {
      return Response.json(
        {
          error: err instanceof Error ? err.message : "Holmes validation failed",
          field: "holmesUrl",
        },
        { status: 422 },
      );
    }
  }

  const cluster = await updateCluster(id, {
    name,
    kubeconfig,
    holmesUrl,
    holmesApiKey,
    lastValidatedAt: new Date(),
  });
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.cluster.updated",
    metadata: { clusterId: id, name },
  });
  return Response.json(cluster);
}

export async function DELETE(_request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const cluster = await getClusterSummary(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });
  await deleteCluster(id);
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.cluster.deleted",
    metadata: { clusterId: id, name: cluster.name },
  });
  return Response.json({ ok: true });
}
