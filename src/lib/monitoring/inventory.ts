import "server-only";
import {
  getClusterSecrets,
  recordDiscoveryError,
  replaceWorkloads,
} from "@/lib/db/monitoring-queries";
import { discoverWorkloads } from "./discovery";
import { detectableTypes } from "./workload-types-live";

export type InventoryResult =
  | { ok: true; context: string; server: string; total: number; removed: number }
  | { ok: false; error: string };

/**
 * Re-scan a cluster's Deployments/StatefulSets — the Rescan button and the
 * worker's periodic refresh (lib/health-checks.ts). A failure is persisted on the
 * cluster row (`discoveryError`) as well as returned, so the UI shows a cluster
 * Drill cannot reach instead of silently serving old data; a success clears it.
 */
export async function refreshInventory(
  clusterId: string,
  orgId: string,
): Promise<InventoryResult | null> {
  const cluster = await getClusterSecrets(clusterId);
  if (!cluster) return null;
  try {
    const discovered = await discoverWorkloads(cluster.kubeconfig, await detectableTypes(orgId));
    const { total, removed } = await replaceWorkloads(clusterId, discovered.workloads);
    return {
      ok: true,
      context: discovered.contextName,
      server: discovered.server,
      total,
      removed,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : "Discovery failed";
    await recordDiscoveryError(clusterId, error);
    return { ok: false, error };
  }
}
