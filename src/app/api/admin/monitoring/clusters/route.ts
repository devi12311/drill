import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { isUniqueViolation } from "@/lib/db";
import {
  createCluster,
  listClusters,
  replaceWorkloads,
} from "@/lib/db/monitoring-queries";
import { discoverWorkloads } from "@/lib/monitoring/discovery";
import { detectableTypes } from "@/lib/monitoring/workload-types-live";
import { validateAgent } from "@/lib/holmes/validate";

export async function GET() {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  return Response.json({ clusters: await listClusters(ctx.orgId) });
}

/**
 * Register a cluster. Both credentials are proved BEFORE the row is written —
 * the kubeconfig by actually listing workloads (which doubles as the first
 * discovery pass) and the Holmes endpoint by listing its models.
 */
export async function POST(request: Request) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();

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

  /**
   * Both credentials are proved concurrently. They are independent — one lists
   * workloads through the kubeconfig, the other lists models on the Holmes
   * endpoint — and each is a network call to a different cluster, so running
   * them in sequence made "Add cluster" take the sum of two timeouts instead of
   * the worse of the two. `allSettled` rather than `all` because each failure
   * has its own `field`, and the kubeconfig's message keeps precedence so the
   * reported error does not depend on which call happened to lose the race.
   */
  const [discovery, agent] = await Promise.allSettled([
    discoverWorkloads(kubeconfig, await detectableTypes(ctx.orgId)),
    validateAgent(holmesUrl, holmesApiKey),
  ]);
  if (discovery.status === "rejected") {
    const err = discovery.reason;
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Kubeconfig validation failed",
        field: "kubeconfig",
      },
      { status: 422 },
    );
  }
  if (agent.status === "rejected") {
    const err = agent.reason;
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Holmes validation failed",
        field: "holmesUrl",
      },
      { status: 422 },
    );
  }
  const discovered = discovery.value;
  const models = agent.value;

  let cluster;
  try {
    cluster = await createCluster({
      orgId: ctx.orgId,
      name,
      kubeconfig,
      holmesUrl,
      holmesApiKey,
      createdBy: ctx.userId,
    });
  } catch (err) {
    // The only constraint a caller can hit is the org-unique name.
    if (isUniqueViolation(err))
      return Response.json(
        { error: `A cluster named "${name}" already exists`, field: "name" },
        { status: 409 },
      );
    throw err;
  }

  await replaceWorkloads(cluster.id, discovered.workloads);
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
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
