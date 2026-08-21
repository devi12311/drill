import { Suspense } from "react";
import { listClusters, listJobs } from "@/lib/db/monitoring-queries";
import {
  MonitoringTree,
  TreeSkeleton,
} from "@/components/monitoring/monitoring-tree";

/**
 * The monitoring module's frame: its own navigation column (clusters → jobs)
 * flush against the admin sidebar, plus a scrolling content region.
 *
 * Rendered on the server so the tree arrives with the page instead of appearing a
 * beat later, but inside `Suspense` so it never HOLDS the page: its two queries
 * walk every cluster and every job in the installation, and the content column is
 * what the operator actually clicked on. Mutations refresh the tree through
 * `useRefreshThenNavigate`, which is careful about the order — see that hook.
 */
export default async function MonitoringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <Suspense fallback={<TreeSkeleton />}>
        <Tree />
      </Suspense>
      <main className="min-h-0 flex-1 overflow-y-auto">
        {/* pb-20 keeps the last row clear of the mode island. */}
        <div className="mx-auto w-full max-w-[900px] px-8 pb-20 pt-8">
          {children}
        </div>
      </main>
    </div>
  );
}

/** Split out purely so `Suspense` has something to await. */
async function Tree() {
  const [clusters, jobs] = await Promise.all([listClusters(), listJobs()]);
  return (
    <MonitoringTree
      clusters={clusters.map((c) => ({
        id: c.id,
        name: c.name,
        discoveryError: c.discoveryError,
      }))}
      jobs={jobs.map((j) => ({
        id: j.id,
        clusterId: j.clusterId,
        name: j.name,
        type: j.type,
        enabled: j.enabled,
        openConcerns: j.openConcerns,
        criticalConcerns: j.criticalConcerns,
      }))}
    />
  );
}
