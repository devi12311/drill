import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  createCluster,
  listClusters,
  replaceWorkloads,
} from "@/lib/db/monitoring-queries";
import { discoverWorkloads } from "@/lib/monitoring/discovery";
import { validateAgent } from "@/lib/holmes/validate";

export async function GET() {
  if (!(await getAdminActor())) return forbidden();
  return Response.json({ clusters: await listClusters() });
}

/**
 * Register a cluster. Both credentials are proved BEFORE the row is written —
 * the kubeconfig by actually listing workloads (which doubles as the first
 * discovery pass) and the Holmes endpoint by listing its models.
 */
export async function POST(request: Request) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();

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

  const name = body.name?.trim() ?? "";
  const kubeconfig = body.kubeconfig?.trim() ?? "";
  const holmesUrl = body.holmesUrl?.trim().replace(/\/$/, "") ?? "";
  const holmesApiKey = body.holmesApiKey?.trim() ?? "";
  if (!name || !kubeconfig || !holmesUrl || !holmesApiKey) {
    return Response.json(
      { error: "name, kubeconfig, holmesUrl and holmesApiKey are required" },
      { status: 400 },
    );
  }
  if (!/^https?:\/\//.test(holmesUrl)) {
    return Response.json(
      { error: "holmesUrl must start with http:// or https://" },
      { status: 400 },
    );
  }

  let discovered;
  try {
    discovered = await discoverWorkloads(kubeconfig);
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Kubeconfig validation failed",
        field: "kubeconfig",
      },
      { status: 422 },
    );
  }

  let models: string[];
  try {
    models = await validateAgent(holmesUrl, holmesApiKey);
  } catch (err) {
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Holmes validation failed",
        field: "holmesUrl",
      },
      { status: 422 },
    );
  }

  let cluster;
  try {
    cluster = await createCluster({
      name,
      kubeconfig,
      holmesUrl,
      holmesApiKey,
      createdBy: actor.id,
    });
  } catch (err) {
    // The only constraint a caller can hit is the unique name.
    if (err instanceof Error && err.message.includes("monitoring_clusters_name"))
      return Response.json(
        { error: `A cluster named "${name}" already exists`, field: "name" },
        { status: 409 },
      );
    throw err;
  }

  await replaceWorkloads(cluster.id, discovered.workloads);
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.cluster.created",
    metadata: {
      clusterId: cluster.id,
      name,
      context: discovered.contextName,
      server: discovered.server,
      workloads: discovered.workloads.length,
    },
  });

  return Response.json(
    {
      ...cluster,
      models,
      discovery: {
        context: discovered.contextName,
        server: discovered.server,
        workloadCount: discovered.workloads.length,
      },
    },
    { status: 201 },
  );
}
