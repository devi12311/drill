import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/monitoring/types";
import { Gauge, Radar, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DeleteClusterButton,
  RescanButton,
} from "@/components/monitoring/cluster-actions";
import { TechnologyCell } from "@/components/monitoring/technology-cell";
import { WorkloadFilter } from "@/components/monitoring/workload-filter";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import {
  getClusterSummary,
  listJobs,
  listWorkloadPage,
  type JobListRow,
  type WorkloadRow,
} from "@/lib/db/monitoring-queries";
import { CATEGORY_LABEL } from "@/lib/monitoring/ui";

/**
 * One cluster: its jobs, its discovered inventory, and the way out.
 *
 * Server-rendered. It used to be a client component whose single fetch of
 * `/api/admin/monitoring/clusters/[id]` returned the cluster, every workload
 * (with the container images nothing displayed) and every job — 164 KB, arriving
 * a round-trip after hydration, behind the word "Loading…". The reads it needs
 * run in parallel here and arrive with the page.
 *
 * The inventory is a PAGE of rows, matched in SQL from `?q=`. Four hundred and
 * sixty-four rows is not a surface anyone reads top to bottom — it is a surface
 * you look something up in — and both of the alternatives (render them all, or
 * ship them all so the browser can filter them) cost hundreds of kilobytes for a
 * lookup that touches one row.
 */
/**
 * Rows per page. Kept small deliberately: each row carries an editable technology
 * cell, which is a client boundary, and every row costs its markup twice — once as
 * HTML and once in the RSC payload. A page of 25 plus a filter is a lookup
 * surface; 464 rows is a download.
 */
const INVENTORY_PAGE = 25;

export default async function ClusterPage({
  params,
  searchParams,
}: {
  params: Promise<{ clusterId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { clusterId } = await params;
  if (!isUuid(clusterId)) notFound();
  const { q } = await searchParams;
  const [cluster, inventory, jobs] = await Promise.all([
    getClusterSummary(clusterId),
    listWorkloadPage(clusterId, { search: q, limit: INVENTORY_PAGE }),
    listJobs(clusterId),
  ]);
  if (!cluster) notFound();

  const workloadColumns: Column<WorkloadRow>[] = [
    {
      key: "kind",
      header: "Kind",
      render: (w) => (
        <span className="font-mono text-[12px] text-bone-gray">
          {w.kind === "statefulset" ? "sts" : "deploy"}
        </span>
      ),
    },
    { key: "namespace", header: "Namespace", render: (w) => w.namespace },
    {
      key: "name",
      header: "Name",
      render: (w) => <span className="text-warm-off-white">{w.name}</span>,
    },
    {
      key: "technology",
      header: "Technology",
      render: (w) => <TechnologyCell clusterId={clusterId} workload={w} />,
    },
    {
      key: "replicas",
      header: "Replicas",
      align: "right",
      render: (w) => (w.replicas === null ? "—" : formatNumber(w.replicas)),
    },
  ];

  const jobColumns: Column<JobListRow>[] = [
    {
      key: "name",
      header: "Job",
      render: (j) => (
        <Link
          href={`/admin/monitoring/${clusterId}/jobs/${j.id}`}
          className="inline-flex items-center gap-2 text-warm-off-white hover:underline"
        >
          {j.type === "security" ? (
            <ShieldCheck className="size-3.5 text-bone-gray" />
          ) : (
            <Gauge className="size-3.5 text-bone-gray" />
          )}
          {j.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (j) => (
        <span className="text-bone-gray">{CATEGORY_LABEL[j.type]}</span>
      ),
    },
    {
      key: "targetCount",
      header: "Workloads",
      align: "right",
      render: (j) => formatNumber(j.targetCount),
    },
    {
      key: "openConcerns",
      header: "Open",
      align: "right",
      render: (j) =>
        j.openConcerns > 0 ? (
          <span
            className={
              j.criticalConcerns > 0 ? "text-traffic-red" : "text-traffic-yellow"
            }
          >
            {formatNumber(j.openConcerns)}
          </span>
        ) : (
          <span className="text-bone-gray">0</span>
        ),
    },
    {
      key: "schedule",
      header: "Schedule",
      render: (j) =>
        j.schedule ? (
          <span className="font-mono text-[12px] text-bone-gray">
            {j.schedule}
          </span>
        ) : (
          <span className="text-bone-gray">manual</span>
        ),
    },
    {
      key: "lastRunAt",
      header: "Last run",
      align: "right",
      render: (j) => formatRelative(j.lastRunAt),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={cluster.name}
        description={
          <>
            Investigated by{" "}
            <span className="font-mono text-[12px]">{cluster.holmesUrl}</span>.
            Inventory refreshed {formatRelative(cluster.lastDiscoveredAt)}.
          </>
        }
      >
        <RescanButton clusterId={clusterId} />
        {/* The cluster's own assessment is a job like any other — this is a
            shortcut into the same form with the cluster preselected, because
            "how is this cluster doing" is the question this page invites. */}
        <Button variant="outline" asChild>
          <Link href={`/admin/monitoring/${clusterId}/jobs/new?target=cluster`}>
            <Radar className="size-3.5" />
            Assess this cluster
          </Link>
        </Button>
        <Button asChild>
          <Link href={`/admin/monitoring/${clusterId}/jobs/new`}>New job</Link>
        </Button>
      </AdminPageHeader>

      {cluster.discoveryError && (
        <Card className="border-traffic-yellow/40 p-4">
          <p className="text-body-sm text-traffic-yellow">
            The last inventory scan failed, so this list may be out of date.
          </p>
          <p className="mt-1 font-mono text-[12px] text-bone-gray">
            {cluster.discoveryError}
          </p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">
          Monitoring jobs
        </h2>
        <DataTable
          columns={jobColumns}
          rows={jobs}
          getKey={(j) => j.id}
          empty="No jobs yet — create one to start assessing workloads."
        />
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-body font-medium text-warm-off-white">
            Discovered workloads
          </h2>
          <Badge variant="outline" className="text-bone-gray">
            {q
              ? `${formatNumber(inventory.matching)} of ${formatNumber(inventory.total)}`
              : formatNumber(inventory.total)}
          </Badge>
          <div className="ml-auto">
            <WorkloadFilter />
          </div>
        </div>
        <DataTable
          columns={workloadColumns}
          rows={inventory.workloads}
          getKey={(w) => `${w.kind}/${w.namespace}/${w.name}`}
          empty={
            q
              ? "No workload matches that filter."
              : "Nothing discovered. Check the kubeconfig's permissions and rescan."
          }
        />
        {inventory.matching > inventory.workloads.length && (
          <p className="text-body-sm text-bone-gray">
            Showing the first {formatNumber(inventory.workloads.length)} of{" "}
            {formatNumber(inventory.matching)} matches — narrow the filter to see
            the rest.
          </p>
        )}
      </section>

      <section className="space-y-2 border-t border-border pt-6">
        <h2 className="text-body font-medium text-warm-off-white">
          Remove cluster
        </h2>
        <p className="max-w-[70ch] text-body-sm text-bone-gray">
          Deletes the cluster, its monitoring jobs and every concern recorded
          against them. The cluster itself is untouched.
        </p>
        <DeleteClusterButton clusterId={clusterId} />
      </section>
    </div>
  );
}
