"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { formatDuration, formatRelative, formatUsd } from "@/lib/admin/format";

interface InvestigationRow {
  messageId: string;
  conversationId: string;
  title: string;
  userId: string;
  username: string;
  model: string | null;
  costUsd: number | null;
  durationMs: number | null;
  toolCalls: number;
  errored: boolean;
  createdAt: string;
}

export default function AdminActivityPage() {
  const [range, setRange] = useState<Range>("7d");
  const { data, loading, error } = useAdminData<{
    investigations: InvestigationRow[];
  }>(`/api/admin/activity?range=${range}`, [range]);

  const columns: Column<InvestigationRow>[] = [
    {
      key: "title",
      header: "Investigation",
      render: (r) => (
        <span className="flex items-center gap-2">
          {r.errored && (
            <AlertTriangle className="size-3.5 shrink-0 text-traffic-yellow" />
          )}
          <span className="truncate text-warm-off-white">{r.title}</span>
        </span>
      ),
    },
    { key: "username", header: "User", render: (r) => r.username },
    {
      key: "model",
      header: "Model",
      render: (r) => (
        <span className="font-mono text-[12px] text-muted-cobalt">
          {r.model ?? "—"}
        </span>
      ),
    },
    {
      key: "toolCalls",
      header: "Tools",
      align: "right",
      render: (r) => r.toolCalls,
    },
    {
      key: "costUsd",
      header: "Cost",
      align: "right",
      render: (r) => (
        <span className="font-mono text-warm-off-white">
          {formatUsd(r.costUsd)}
        </span>
      ),
    },
    {
      key: "durationMs",
      header: "Duration",
      align: "right",
      render: (r) => formatDuration(r.durationMs),
    },
    {
      key: "status",
      header: "",
      render: (r) =>
        r.errored ? (
          <Badge variant="outline" className="text-traffic-yellow">
            tool errors
          </Badge>
        ) : null,
    },
    {
      key: "createdAt",
      header: "When",
      align: "right",
      render: (r) => formatRelative(r.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Activity"
        description="Every investigation across all users, newest first."
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
          rows={data.investigations}
          getKey={(r) => r.messageId}
          empty="No investigations in this range."
        />
      )}
    </div>
  );
}
