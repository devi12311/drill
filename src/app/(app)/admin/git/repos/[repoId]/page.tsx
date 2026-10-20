import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { BranchAdder } from "@/components/git/branch-adder";
import { RemoveBranchButton, RemoveRepoButton, SyncButton } from "@/components/git/git-actions";
import { SyncPoller } from "@/components/git/sync-poller";
import { SyncState } from "@/components/git/sync-state";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import { getConnectionSummary, getRepository, type BranchRow } from "@/lib/db/git-queries";
import { gitPageContext } from "@/lib/git/access";
import { ACTIVE_SYNC_STATES, PROVIDER_LABEL } from "@/lib/git/types";
import { shortSha } from "@/lib/git/ui";

/**
 * One repository: a row per tracked branch (each its own worktree and index on the
 * gateway). Sync is manual; while anything is queued or indexing the page re-renders
 * itself until it settles.
 */
export default async function RepositoryPage({ params }: { params: Promise<{ repoId: string }> }) {
  const { repoId } = await params;
  const { orgId } = await gitPageContext();
  const repo = await getRepository(orgId, repoId);
  if (!repo) notFound();
  const connection = await getConnectionSummary(orgId, repo.connectionId);
  if (!connection) notFound();
  const active = repo.branches.some((b) => ACTIVE_SYNC_STATES.includes(b.state));
  const syncUrl = `/api/admin/git/repositories/${repo.id}/sync`;

  const columns: Column<BranchRow>[] = [
    {
      key: "name",
      header: "Branch",
      render: (b) => (
        <span className="font-mono text-[13px] text-warm-off-white">
          {b.name}
          {b.name === repo.defaultBranch && <span className="ml-2 font-sans text-[12px] text-bone-gray">default</span>}
        </span>
      ),
    },
    { key: "commit", header: "Commit", render: (b) => <span className="font-mono text-[12px] text-bone-gray">{shortSha(b.lastSha)}</span> },
    { key: "synced", header: "Synced", render: (b) => <span className="text-bone-gray">{formatRelative(b.lastSyncedAt)}</span> },
    {
      key: "files",
      header: "Files",
      align: "right",
      render: (b) => <span className="text-bone-gray">{b.stats ? formatNumber(b.stats.files) : "—"}</span>,
    },
    {
      key: "state",
      header: "State",
      render: (b) => (
        <div>
          <SyncState state={b.state} />
          {b.state === "error" && b.error && (
            <p className="mt-1 max-w-[42ch] font-mono text-[12px] text-bone-gray" title={b.error}>
              {b.error.length > 160 ? `${b.error.slice(0, 160)}…` : b.error}
              {b.lastSha && " — the agent still reads the previous index."}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (b) => (
        <div className="flex items-center justify-end gap-1">
          <SyncButton
            url={syncUrl}
            branchId={b.id}
            label={`Sync ${b.name}`}
            compact
            disabled={ACTIVE_SYNC_STATES.includes(b.state)}
          />
          {b.name !== repo.defaultBranch && <RemoveBranchButton repoId={repo.id} branchId={b.id} branch={b.name} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <SyncPoller active={active} />
      <AdminPageHeader
        title={repo.name}
        description={
          <>
            <span className="font-mono text-[12px]">{repo.fullName}</span> from{" "}
            <Link href={`/admin/git/connections/${connection.id}`} className="text-pale-stone hover:underline">
              {connection.name}
            </Link>{" "}
            ({PROVIDER_LABEL[connection.provider]}). The agent addresses it as{" "}
            <span className="font-mono text-[12px] text-pale-stone">{repo.name}</span>.
            {active && " A first index can take a few minutes."}
          </>
        }
      >
        <SyncButton url={syncUrl} label="Sync all branches" disabled={active} />
      </AdminPageHeader>

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">Tracked branches</h2>
        <DataTable columns={columns} rows={repo.branches} getKey={(b) => b.id} />
        <BranchAdder repoId={repo.id} />
      </section>

      <RemoveRepoButton repoId={repo.id} connectionId={connection.id} />
    </div>
  );
}
