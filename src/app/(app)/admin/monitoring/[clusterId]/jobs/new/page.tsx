import { notFound } from "next/navigation";
import { isUuid } from "@/lib/monitoring/types";
import { AdminPageHeader } from "@/components/admin/page-header";
import { JobForm } from "@/components/monitoring/job-form";
import {
  getClusterSummary,
  listWorkloads,
} from "@/lib/db/monitoring-queries";
import { checkRubricItems } from "@/lib/monitoring/checks";

/**
 * Create a job. Server-rendered: this and the edit page were the two heaviest
 * routes in the module, each firing three or four client fetches after hydration
 * (cluster detail — which also returned the cluster's jobs — the check catalogue,
 * the job, and the model probe) behind the word "Loading…". Only the model probe
 * is still a client fetch, and for a reason: see `JobForm`.
 */
export default async function NewJobPage({
  params,
  searchParams,
}: {
  params: Promise<{ clusterId: string }>;
  searchParams: Promise<{ target?: string }>;
}) {
  const { clusterId } = await params;
  if (!isUuid(clusterId)) notFound();
  // Set by the cluster page's "Assess this cluster" action. Read here and passed
  // down as initial state, so the form has no effect that could fight the operator.
  const startOnCluster = (await searchParams).target === "cluster";

  const [cluster, workloads, checks] = await Promise.all([
    getClusterSummary(clusterId),
    listWorkloads(clusterId),
    checkRubricItems(),
  ]);
  if (!cluster) notFound();

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="New monitoring job"
        description={`Pick what matters in ${cluster.name} — the cluster itself, or the workloads in it — and what Holmes should look for. Findings are deduplicated across runs, so this job accumulates a history rather than a pile of reports.`}
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
        workloads={workloads.map((w) => ({
          kind: w.kind,
          namespace: w.namespace,
          name: w.name,
          replicas: w.replicas,
          technology: w.technology,
          profiled: w.profiled,
        }))}
        checks={checks}
        startOnCluster={startOnCluster}
      />
    </div>
  );
}
