import { Suspense } from "react";
import { monitoringPageContext } from "@/lib/monitoring/access";
import { listClusters, listJobs } from "@/lib/db/monitoring-queries";
import { clusterStatus } from "@/lib/health";
import { technologyLabels } from "@/lib/monitoring/workload-types-live";
import { TechnologiesProvider } from "@/components/monitoring/technologies-provider";
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
 *
 * The org's workload types ARE awaited here (one small query): every screen below
 * names technologies, and they are data now (decision 128), so the provider has to
 * hold them before any of those screens renders.
 */
export default async function MonitoringLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { orgId } = await monitoringPageContext();
  const technologies = await technologyLabels(orgId);
  return (
    <TechnologiesProvider technologies={technologies}>
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
    </TechnologiesProvider>
  );
}

/** Split out purely so `Suspense` has something to await. */
async function Tree() {
  const { orgId } = await monitoringPageContext();
  const [clusters, jobs] = await Promise.all([
    listClusters(orgId),
    listJobs(orgId),
  ]);
  return (
    <MonitoringTree
      clusters={clusters.map((c) => ({
        id: c.id,
        name: c.name,
        status: clusterStatus(c),
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
