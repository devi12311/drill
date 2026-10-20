import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Card } from "@/components/ui/card";
import { ConnectionForm } from "@/components/git/connection-form";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import { listConnections, type ConnectionRow } from "@/lib/db/git-queries";
import { gitPageContext } from "@/lib/git/access";
import { gateway } from "@/lib/git/gateway";
import { PROVIDER_LABEL } from "@/lib/git/types";
import { gitConnectionHealth, HEALTH_TEXT } from "@/lib/health";

const GIB = 1024 ** 3;

/** The connection index, plus the gateway's own health — the one dependency every row shares. */
export default async function GitHomePage() {
  const { orgId } = await gitPageContext();
  const [connections, health] = await Promise.all([
    listConnections(orgId),
    gateway.health().then(
      (h) => ({ ok: true as const, ...h }),
      (err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }),
    ),
  ]);

  const columns: Column<ConnectionRow>[] = [
    {
      key: "name",
      header: "Connection",
      render: (c) => (
        <Link href={`/admin/git/connections/${c.id}`} className="text-warm-off-white hover:underline">
          {c.name}
        </Link>
      ),
    },
    {
      key: "provider",
      header: "Account",
      render: (c) => (
        <span className="text-bone-gray">
          {PROVIDER_LABEL[c.provider]} · <span className="font-mono text-[12px]">{c.account}</span>
        </span>
      ),
    },
    { key: "repoCount", header: "Repositories", align: "right", render: (c) => formatNumber(c.repoCount) },
    {
      key: "health",
      header: "Token",
      align: "right",
      render: (c) => {
        const h = gitConnectionHealth(c);
        return (
          <span className={HEALTH_TEXT[h]} title={c.lastError ?? undefined}>
            {h === "ok" ? `valid · ${formatRelative(c.lastValidatedAt)}` : h === "down" ? "rejected" : "not checked"}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="Git"
        description="Connect GitHub or Bitbucket and choose the repositories to sync. Each tracked branch is cloned and indexed into a code graph the agent queries directly — callers, impact, symbol search — instead of crawling files one call at a time."
      />

      <p className="text-body-sm text-bone-gray">
        Code index gateway:{" "}
        {health.ok ? (
          <span className="text-traffic-green">
            reachable · codegraph {health.codegraph} · {(health.diskFreeBytes / GIB).toFixed(1)} GiB free
          </span>
        ) : (
          <span className="text-traffic-red" title={health.error}>
            unreachable — syncs will fail until it answers
          </span>
        )}
      </p>

      {connections.length > 0 && <DataTable columns={columns} rows={connections} getKey={(c) => c.id} />}

      <Card className="space-y-4 p-6">
        <div className="space-y-1">
          <h2 className="text-body font-medium text-warm-off-white">Connect an account</h2>
          <p className="text-body-sm text-bone-gray">
            A read-only token is enough: Drill lists repositories with it, and the gateway clones with it. It is stored
            encrypted and never sent to the agent.
          </p>
        </div>
        <ConnectionForm />
      </Card>
    </div>
  );
}
