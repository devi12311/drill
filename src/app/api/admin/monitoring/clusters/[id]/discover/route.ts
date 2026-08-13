import { forbidden, getAdminActor } from "@/lib/auth/session";
import {
  getClusterSecrets,
  recordDiscoveryError,
  replaceWorkloads,
} from "@/lib/db/monitoring-queries";
import { discoverWorkloads } from "@/lib/monitoring/discovery";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Re-scan a cluster's Deployments/StatefulSets. A failure is persisted on the
 * cluster row (`discoveryError`) as well as returned, so the UI can show a
 * stale inventory honestly instead of silently serving old data.
 */
export async function POST(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const cluster = await getClusterSecrets(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const discovered = await discoverWorkloads(cluster.kubeconfig);
    const { total, removed } = await replaceWorkloads(id, discovered.workloads);
    return Response.json({
      context: discovered.contextName,
      server: discovered.server,
      total,
      removed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Discovery failed";
    await recordDiscoveryError(id, message);
    return Response.json({ error: message }, { status: 422 });
  }
}
