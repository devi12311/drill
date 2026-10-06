import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { monitoringNotFound, ownsMonitoring } from "@/lib/monitoring/access";
import {
  getClusterSecrets,
  recordDiscoveryError,
  replaceWorkloads,
} from "@/lib/db/monitoring-queries";
import { discoverWorkloads } from "@/lib/monitoring/discovery";
import { detectableTypes } from "@/lib/monitoring/workload-types-live";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Re-scan a cluster's Deployments/StatefulSets. A failure is persisted on the
 * cluster row (`discoveryError`) as well as returned, so the UI can show a
 * stale inventory honestly instead of silently serving old data.
 */
export async function POST(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const { id } = await context.params;
  if (!(await ownsMonitoring(ctx, { cluster: id }))) return monitoringNotFound();
  const cluster = await getClusterSecrets(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const discovered = await discoverWorkloads(cluster.kubeconfig, await detectableTypes(ctx.orgId));
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
