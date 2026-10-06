"use client";

import { useState } from "react";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { formatNumber, formatRelative, formatUsd } from "@/lib/admin/format";

interface OrgStats {
  id: string;
  name: string;
  createdAt: string;
  members: number;
  agents: number;
  clusters: number;
  spend: number;
  investigations: number;
  lastActive: string | null;
}

/**
 * Every tenant at a glance — the one cross-org view the console keeps now that
 * Overview, Cost and Activity describe the active org only.
 */
export default function AdminOrgsPage() {
  const [range, setRange] = useState<Range>("30d");
  const { data, loading, error } = useAdminData<{ orgs: OrgStats[] }>(
    `/api/admin/orgs?range=${range}`,
    [range],
  );

  const columns: Column<OrgStats>[] = [
    {
      key: "name",
      header: "Organization",
      render: (o) => <span className="text-warm-off-white">{o.name}</span>,
    },
    { key: "members", header: "Members", align: "right", render: (o) => formatNumber(o.members) },
    { key: "agents", header: "Agents", align: "right", render: (o) => formatNumber(o.agents) },
    { key: "clusters", header: "Clusters", align: "right", render: (o) => formatNumber(o.clusters) },
    {
      key: "investigations",
      header: "Runs",
      align: "right",
      render: (o) => formatNumber(o.investigations),
    },
    {
      key: "spend",
      header: "Spend",
      align: "right",
      render: (o) => <span className="font-mono text-warm-off-white">{formatUsd(o.spend)}</span>,
    },
    {
      key: "lastActive",
      header: "Last active",
      align: "right",
      render: (o) => formatRelative(o.lastActive),
    },
    {
      key: "createdAt",
      header: "Created",
      align: "right",
      render: (o) => formatRelative(o.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Organizations"
        description="Every tenant on this Drill. Runs and spend cover chat investigations in the selected range."
      >
        <RangePicker value={range} onChange={setRange} />
      </AdminPageHeader>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data.orgs}
          getKey={(o) => o.id}
          empty="No organizations yet."
        />
      )}
    </div>
  );
}
