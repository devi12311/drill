"use client";

import { use } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { JobForm } from "@/components/monitoring/job-form";
import type { PickableWorkload } from "@/components/monitoring/workload-picker";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { KNOWN_MODELS } from "@/lib/holmes/types";

import type { CheckView } from "@/lib/monitoring/types";

interface ClusterDetail {
  cluster: { id: string; name: string };
  /** The picker's own contract, so the two cannot drift on what a workload carries. */
  workloads: PickableWorkload[];
}

export default function NewJobPage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = use(params);
  const { data, loading, error } = useAdminData<ClusterDetail>(
    `/api/admin/monitoring/clusters/${clusterId}`,
    [clusterId],
  );
  // The cluster's own Holmes is the one that will run this job, so its model
  // list is the right source. Falls back to the known set if it can't be read.
  const models = useAdminData<{ models?: string[] }>(
    `/api/admin/monitoring/clusters/${clusterId}/models`,
    [clusterId],
  );
  const catalogue = useAdminData<{ checks: CheckView[] }>(
    "/api/admin/monitoring/checks",
    [],
  );

  if (error)
    return <p className="py-8 text-body-sm text-traffic-red">{error}</p>;
  if (loading || !data || catalogue.loading)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="New monitoring job"
        description={`Pick the workloads in ${data.cluster.name} that matter, and what Holmes should look for. Findings are deduplicated across runs, so this job accumulates a history rather than a pile of reports.`}
      />
      {data.workloads.length === 0 ? (
        <p className="text-body-sm text-bone-gray">
          No workloads have been discovered for this cluster yet — rescan it
          first.
        </p>
      ) : (
        <JobForm
          clusterId={clusterId}
          workloads={data.workloads}
          models={
            models.data?.models?.length ? models.data.models : KNOWN_MODELS
          }
          checks={catalogue.data?.checks ?? []}
        />
      )}
    </div>
  );
}
