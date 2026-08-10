"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { formatNumber, formatRelative } from "@/lib/admin/format";

interface AgentHealthRow {
  id: string;
  name: string;
  url: string;
  ownerUsername: string;
  lastValidatedAt: string | null;
  conversationCount: number;
}

// Older than this since last successful validation ⇒ flag as stale.
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export default function AdminAgentsPage() {
  const { data, loading, error } = useAdminData<{ agents: AgentHealthRow[] }>(
    "/api/admin/agents",
    [],
  );

  const columns: Column<AgentHealthRow>[] = [
    { key: "name", header: "Agent", render: (a) => a.name },
    {
      key: "ownerUsername",
      header: "Owner",
      render: (a) => a.ownerUsername,
    },
    {
      key: "url",
      header: "URL",
      render: (a) => (
        <span className="font-mono text-[12px] text-bone-gray">{a.url}</span>
      ),
    },
    {
      key: "conversationCount",
      header: "Convos",
      align: "right",
      render: (a) => formatNumber(a.conversationCount),
    },
    {
      key: "health",
      header: "Health",
      render: (a) => {
        const stale =
          !a.lastValidatedAt ||
          Date.now() - new Date(a.lastValidatedAt).getTime() > STALE_MS;
        return stale ? (
          <Badge variant="outline" className="text-traffic-yellow">
            stale
          </Badge>
        ) : (
          <Badge variant="outline" className="text-traffic-green">
            ok
          </Badge>
        );
      },
    },
    {
      key: "lastValidatedAt",
      header: "Last validated",
      align: "right",
      render: (a) => formatRelative(a.lastValidatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Agent health"
        description="Every Holmes endpoint across all users. Stale endpoints are a common cause of user-side failures."
      />

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <DataTable
          columns={columns}
          rows={data.agents}
          getKey={(a) => a.id}
          empty="No agents registered."
        />
      )}
    </div>
  );
}
