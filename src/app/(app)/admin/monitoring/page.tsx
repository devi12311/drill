import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Card } from "@/components/ui/card";
import { ClusterForm } from "@/components/monitoring/cluster-form";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import { listClusters, type ClusterListRow } from "@/lib/db/monitoring-queries";

/**
 * The cluster index, rendered on the server.
 *
 * It used to be a client component that fetched `/api/admin/monitoring/clusters`
 * on mount, so the page arrived as the word "Loading…" and the table appeared a
 * round-trip later — for data the server already had in hand while rendering the
 * sidebar tree from the very same query. Reading the query directly removes the
 * HTTP hop, the second auth pass and the waterfall. The API route stays: it is
 * what `ClusterForm` posts to.
 */
export default async function MonitoringHomePage() {
  const clusters = await listClusters();

  const columns: Column<ClusterListRow>[] = [
    {
      key: "name",
      header: "Cluster",
      render: (c) => (
        <Link
          href={`/admin/monitoring/${c.id}`}
          className="text-warm-off-white hover:underline"
        >
          {c.name}
        </Link>
      ),
    },
    {
      key: "workloadCount",
      header: "Workloads",
      align: "right",
      render: (c) => formatNumber(c.workloadCount),
    },
    {
      key: "jobCount",
      header: "Jobs",
      align: "right",
      render: (c) => formatNumber(c.jobCount),
    },
    {
      key: "openConcerns",
      header: "Open concerns",
      align: "right",
      render: (c) =>
        c.openConcerns > 0 ? (
          <span className="text-traffic-yellow">
            {formatNumber(c.openConcerns)}
          </span>
        ) : (
          <span className="text-bone-gray">0</span>
        ),
    },
    {
      key: "lastDiscoveredAt",
      header: "Inventory",
      align: "right",
      render: (c) =>
        c.discoveryError ? (
          <span className="text-traffic-yellow" title={c.discoveryError}>
            stale
          </span>
        ) : (
          formatRelative(c.lastDiscoveredAt)
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Monitoring"
        description="Register a cluster, choose the Deployments and StatefulSets that matter, and let Holmes assess them on a schedule. Findings accumulate as a history of concerns per job."
      />

      {clusters.length > 0 && (
        <DataTable columns={columns} rows={clusters} getKey={(c) => c.id} />
      )}

      <Card className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 className="text-body font-medium text-warm-off-white">
            Add a cluster
          </h2>
          <p className="text-body-sm text-bone-gray">
            Drill needs two things: a kubeconfig to list your workloads, and a
            Holmes endpoint running inside that cluster to investigate them.
          </p>
        </div>
        {/* No `onCreated` callback any more: this table is server-rendered, and
            the form's refresh-then-navigate updates it along with the tree. */}
        <ClusterForm />
      </Card>
    </div>
  );
}
