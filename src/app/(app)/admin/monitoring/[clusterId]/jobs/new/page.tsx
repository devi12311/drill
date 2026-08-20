"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/page-header";
import { JobForm } from "@/components/monitoring/job-form";
import { useJobFormData } from "@/lib/monitoring/use-job-form-data";

export default function NewJobPage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = use(params);
  // Set by the cluster page's "Assess this cluster" action. Read here and passed
  // down as initial state, so the form has no effect that could fight the operator.
  const startOnCluster = useSearchParams().get("target") === "cluster";
  const { clusterName, workloads, models, checks, loading, error } =
    useJobFormData(clusterId);

  if (error)
    return <p className="py-8 text-body-sm text-traffic-red">{error}</p>;
  if (loading)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="New monitoring job"
        description={`Pick what matters in ${clusterName} — the cluster itself, or the workloads in it — and what Holmes should look for. Findings are deduplicated across runs, so this job accumulates a history rather than a pile of reports.`}
      />
      {/* An empty inventory no longer hides the form: the cluster itself is a
          selectable target and needs no discovered workloads to assess. */}
      {workloads.length === 0 && (
        <p className="text-body-sm text-bone-gray">
          No workloads have been discovered for this cluster yet — rescan it to
          assess individual workloads. The cluster itself can be assessed anyway.
        </p>
      )}
      <JobForm
        clusterId={clusterId}
        workloads={workloads}
        models={models}
        checks={checks}
        startOnCluster={startOnCluster}
      />
    </div>
  );
}
