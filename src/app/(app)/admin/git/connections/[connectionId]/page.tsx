import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Card } from "@/components/ui/card";
import { ConnectionForm } from "@/components/git/connection-form";
import { CheckConnectionButton, DeleteConnectionButton, SyncButton } from "@/components/git/git-actions";
import { AddRepositoriesButton } from "@/components/git/repo-picker-dialog";
import { SyncPoller } from "@/components/git/sync-poller";
import { SyncState } from "@/components/git/sync-state";
import { formatRelative } from "@/lib/admin/format";
import { getConnectionSummary, listRepositories, type RepositoryWithBranches } from "@/lib/db/git-queries";
import { gitPageContext } from "@/lib/git/access";
import { ACTIVE_SYNC_STATES, PROVIDER_LABEL } from "@/lib/git/types";
import { rollupState } from "@/lib/git/ui";
import { GIT_CONNECTION_PROBE_MS, gitConnectionHealth, HEALTH_TEXT } from "@/lib/health";

/** One connection: its repositories and their sync state, and the credentials behind them. */
export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ connectionId: string }>;
  searchParams: Promise<{ add?: string }>;
}) {
  const { connectionId } = await params;
  const { orgId } = await gitPageContext();
  const [connection, repos, { add }] = await Promise.all([
    getConnectionSummary(orgId, connectionId),
    listRepositories(orgId, connectionId),
    searchParams,
  ]);
  if (!connection) notFound();
  const health = gitConnectionHealth(connection);
  const active = repos.some((r) => r.branches.some((b) => ACTIVE_SYNC_STATES.includes(b.state)));

  const columns: Column<RepositoryWithBranches>[] = [
    {
      key: "name",
      header: "Repository",
      render: (r) => (
        <Link href={`/admin/git/repos/${r.id}`} className="text-warm-off-white hover:underline">
          {r.name}
        </Link>
      ),
    },
    {
      key: "branches",
      header: "Branches",
      render: (r) => <span className="font-mono text-[12px] text-bone-gray">{r.branches.map((b) => b.name).join(", ")}</span>,
    },
    {
      key: "synced",
      header: "Last sync",
      align: "right",
      render: (r) => {
        const last = r.branches.map((b) => b.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
        return <span className="text-bone-gray">{formatRelative(last)}</span>;
      },
    },
    {
      key: "state",
      header: "State",
      align: "right",
      render: (r) => <SyncState state={rollupState(r.branches.map((b) => b.state))} />,
    },
  ];

  return (
    <div className="space-y-8">
      <SyncPoller active={active} />
      <AdminPageHeader
        title={connection.name}
        description={
          <>
            {PROVIDER_LABEL[connection.provider]} · <span className="font-mono text-[12px]">{connection.account}</span>
            {" — "}
            <span className={HEALTH_TEXT[health]}>
              {health === "ok"
                ? `token valid, checked ${formatRelative(connection.lastValidatedAt)}`
                : health === "down"
                  ? "token rejected"
                  : "not checked recently"}
            </span>
            . Re-checked every {GIT_CONNECTION_PROBE_MS / 60_000} minutes.
          </>
        }
      >
        <CheckConnectionButton connectionId={connection.id} />
        {repos.length > 0 && (
          <SyncButton url={`/api/admin/git/connections/${connection.id}/sync`} label="Sync all" disabled={active} />
        )}
        <AddRepositoriesButton connectionId={connection.id} defaultOpen={add === "1"} />
      </AdminPageHeader>

      {health === "down" && connection.lastError && (
        <Card className="border-traffic-red/40 p-4">
          <p className="text-body-sm text-traffic-red">The provider refuses this token — syncs will fail until it is replaced.</p>
          <p className="mt-1 font-mono text-[12px] text-bone-gray">{connection.lastError}</p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">Repositories</h2>
        <DataTable
          columns={columns}
          rows={repos}
          getKey={(r) => r.id}
          empty="No repositories yet — add the ones the agent should be able to read."
        />
      </section>

      <Card className="space-y-4 p-6">
        <h2 className="text-body font-medium text-warm-off-white">Credentials</h2>
        <ConnectionForm
          existing={{
            id: connection.id,
            provider: connection.provider,
            name: connection.name,
            account: connection.account,
            username: connection.username,
            repoCount: repos.length,
          }}
        />
      </Card>

      <DeleteConnectionButton connectionId={connection.id} repoCount={repos.length} />
    </div>
  );
}
