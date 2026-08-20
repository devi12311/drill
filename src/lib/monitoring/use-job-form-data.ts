"use client";

import { useAdminData } from "@/lib/admin/use-admin-data";
import { KNOWN_MODELS } from "@/lib/holmes/types";
import type { PickableWorkload } from "@/components/monitoring/workload-picker";
import type { CheckView } from "@/lib/monitoring/types";

interface ClusterDetail {
  cluster: { id: string; name: string };
  /** The picker's own contract, so the two cannot drift on what a workload carries. */
  workloads: PickableWorkload[];
}

/**
 * Everything {@link JobForm} needs about a cluster: its workload inventory, the
 * models its own Holmes serves, and the live check catalogue.
 *
 * Shared by the create and edit pages so neither can quietly get the fallbacks
 * wrong — a cluster whose `/api/model` call fails must still offer models, and a
 * cluster with no discovered workloads must still render the form, because the
 * cluster itself is a target that needs no inventory.
 */
export function useJobFormData(clusterId: string) {
  const cluster = useAdminData<ClusterDetail>(
    `/api/admin/monitoring/clusters/${clusterId}`,
    [clusterId],
  );
  // The cluster's own Holmes is the one that will run the job, so its model list
  // is the right source. Deliberately not gated on below: a slow or unreachable
  // agent must not hold up the form when the known set will do.
  const models = useAdminData<{ models?: string[] }>(
    `/api/admin/monitoring/clusters/${clusterId}/models`,
    [clusterId],
  );
  const catalogue = useAdminData<{ checks: CheckView[] }>(
    "/api/admin/monitoring/checks",
    [],
  );

  return {
    clusterName: cluster.data?.cluster.name ?? "",
    workloads: cluster.data?.workloads ?? [],
    models: models.data?.models?.length ? models.data.models : KNOWN_MODELS,
    checks: catalogue.data?.checks ?? [],
    loading: cluster.loading || catalogue.loading || !cluster.data,
    error: cluster.error ?? catalogue.error,
  };
}
