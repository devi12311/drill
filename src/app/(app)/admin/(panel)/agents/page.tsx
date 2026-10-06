"use client";

import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import { agentHealth, HEALTH_TEXT, type Health } from "@/lib/health";

interface AgentHealthRow {
  id: string;
  name: string;
  url: string;
  addedByUsername: string | null;
  lastValidatedAt: string | null;
  lastError: string | null;
  conversationCount: number;
}

const HEALTH_LABEL: Record<Health, string> = {
  ok: "reachable",
  down: "unreachable",
  stale: "not checked",
};

export default function AdminAgentsPage() {
  const { data, loading, error } = useAdminData<{ agents: AgentHealthRow[] }>(
    "/api/admin/agents",
    [],
  );

  const columns: Column<AgentHealthRow>[] = [
    { key: "name", header: "Agent", render: (a) => a.name },
    {
      key: "addedByUsername",
      header: "Added by",
      render: (a) => a.addedByUsername ?? "—",
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
        const h = agentHealth(a);
        return (
          <div className="min-w-0">
            <Badge
              variant="outline"
              className={HEALTH_TEXT[h]}
              title={
                h === "stale"
                  ? "No successful check recently — is the Drill worker running?"
                  : undefined
              }
            >
              {HEALTH_LABEL[h]}
            </Badge>
            {h === "down" && a.lastError && (
              <p className="mt-1 max-w-[40ch] truncate text-[12px] text-bone-gray" title={a.lastError}>
                {a.lastError}
              </p>
            )}
          </div>
        );
      },
    },
    {
      key: "lastValidatedAt",
      header: "Last reached",
      align: "right",
      render: (a) => formatRelative(a.lastValidatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Agent health"
        description="Your org's Holmes agents. Drill checks each one every few minutes; hover a failing agent to see why it can't be reached."
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
