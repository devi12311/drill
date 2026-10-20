import { Suspense } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { GitTree, GitTreeSkeleton } from "@/components/git/git-tree";
import { listConnections, listRepositories } from "@/lib/db/git-queries";
import { gitPageContext } from "@/lib/git/access";
import { gitModuleEnabled } from "@/lib/git/gateway";
import { rollupState } from "@/lib/git/ui";
import { gitConnectionHealth } from "@/lib/health";

/**
 * The Git module's frame: its own navigation column (connections → repositories)
 * beside a scrolling content region — the same shape as Monitoring. The tree is
 * streamed in under Suspense so it never holds the page the admin clicked on.
 */
export default async function GitLayout({ children }: { children: React.ReactNode }) {
  await gitPageContext();
  if (!gitModuleEnabled()) return <NotConfigured />;
  return (
    <div className="flex min-h-0 flex-1">
      <Suspense fallback={<GitTreeSkeleton />}>
        <Tree />
      </Suspense>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {/* pb-20 keeps the last row clear of the mode island. */}
        <div className="mx-auto w-full max-w-[900px] px-8 pb-20 pt-8">{children}</div>
      </main>
    </div>
  );
}

async function Tree() {
  const { orgId } = await gitPageContext();
  const [connections, repos] = await Promise.all([listConnections(orgId), listRepositories(orgId)]);
  return (
    <GitTree
      connections={connections.map((c) => {
        const health = gitConnectionHealth(c);
        return {
          id: c.id,
          name: c.name,
          health,
          healthTitle: c.lastError ?? (health === "ok" ? "Token valid" : "Not checked recently"),
        };
      })}
      repos={repos.map((r) => ({
        id: r.id,
        connectionId: r.connectionId,
        name: r.name,
        state: rollupState(r.branches.map((b) => b.state)),
      }))}
    />
  );
}

/**
 * The module is optional per install. Rather than a menu entry that silently
 * 404s, say what turns it on.
 */
function NotConfigured() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[900px] space-y-6 px-8 pb-20 pt-8">
        <AdminPageHeader
          title="Git"
          description="Connect GitHub or Bitbucket, choose repositories, and the agent queries a pre-built code graph of them instead of crawling files."
        />
        <Card className="space-y-2 p-6">
          <h2 className="text-body font-medium text-warm-off-white">Not configured on this install</h2>
          <p className="text-body-sm text-bone-gray">
            The module needs the codegraph gateway (<span className="font-mono text-[12px]">codegraph-gateway/</span>
            , enabled with <span className="font-mono text-[12px]">codegraph.enabled</span> in the Drill chart). Set{" "}
            <span className="font-mono text-[12px]">CODEGRAPH_GATEWAY_URL</span> and{" "}
            <span className="font-mono text-[12px]">CODEGRAPH_GATEWAY_SECRET</span> on the Drill web and worker pods.
          </p>
        </Card>
      </div>
    </main>
  );
}
