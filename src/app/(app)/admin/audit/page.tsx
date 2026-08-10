"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { formatDateTime } from "@/lib/admin/format";

interface AuditRow {
  id: string;
  action: string;
  actorUsername: string | null;
  targetUsername: string | null;
  metadata: unknown;
  createdAt: string;
}

const ACTION_LABEL: Record<string, string> = {
  "impersonate.start": "Started impersonating",
  "impersonate.stop": "Stopped impersonating",
};

export default function AdminAuditPage() {
  const [range, setRange] = useState<Range>("30d");
  const { data, loading, error } = useAdminData<{ entries: AuditRow[] }>(
    `/api/admin/audit?range=${range}`,
    [range],
  );

  const columns: Column<AuditRow>[] = [
    {
      key: "action",
      header: "Action",
      render: (r) => (
        <Badge variant="outline" className="text-muted-cobalt">
          {ACTION_LABEL[r.action] ?? r.action}
        </Badge>
      ),
    },
    {
      key: "actor",
      header: "Admin",
      render: (r) => r.actorUsername ?? "—",
    },
    {
      key: "target",
      header: "Target user",
      render: (r) => (
        <span className="text-warm-off-white">{r.targetUsername ?? "—"}</span>
      ),
    },
    {
      key: "createdAt",
      header: "When",
      align: "right",
      render: (r) => formatDateTime(r.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Audit log"
        description="Privileged admin actions — impersonation start/stop."
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
          rows={data.entries}
          getKey={(r) => r.id}
          empty="No admin actions recorded in this range."
        />
      )}
    </div>
  );
}
