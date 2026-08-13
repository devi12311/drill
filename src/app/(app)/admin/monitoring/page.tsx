"use client";

import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Card } from "@/components/ui/card";
import { ClusterForm } from "@/components/monitoring/cluster-form";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";

interface ClusterRow {
  id: string;
  name: string;
  holmesUrl: string;
  lastDiscoveredAt: string | null;
  discoveryError: string | null;
  workloadCount: number;
  jobCount: number;
  openConcerns: number;
}

export default function MonitoringHomePage() {
  const { data, loading, error, refetch } = useAdminData<{
    clusters: ClusterRow[];
  }>("/api/admin/monitoring/clusters", []);

  const columns: Column<ClusterRow>[] = [
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

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : data.clusters.length > 0 ? (
        <DataTable
          columns={columns}
          rows={data.clusters}
          getKey={(c) => c.id}
        />
      ) : null}

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
        <ClusterForm onCreated={refetch} />
      </Card>
    </div>
  );
}
