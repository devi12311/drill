"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { BookOpen, Boxes, Gauge, ListChecks, Radar, ShieldCheck } from "lucide-react";
import {
  NavTreeAdd,
  NavTreeBranch,
  NavTreeColumn,
  NavTreeEmpty,
  NavTreeEmptyChild,
  NavTreeLeaf,
  NavTreeSkeleton,
} from "@/components/admin/nav-tree";
import { HEALTH_DOT, type ClusterStatus } from "@/lib/health";
import { cn } from "@/lib/utils";

export interface TreeJob {
  id: string;
  clusterId: string;
  name: string;
  type: "security" | "performance";
  enabled: boolean;
  openConcerns: number;
  criticalConcerns: number;
}

export interface TreeCluster {
  id: string;
  name: string;
  /** Derived on the server (lib/health.ts), so the dot never flips on hydration. */
  status: ClusterStatus;
}

/**
 * The monitoring module's own navigation column: registered clusters as
 * collapsible roots, their monitoring jobs as children (frame and rows:
 * components/admin/nav-tree.tsx).
 */
export function MonitoringTree({
  clusters,
  jobs,
}: {
  clusters: TreeCluster[];
  jobs: TreeJob[];
}) {
  const pathname = usePathname();
  /**
   * Grouped once, and the per-cluster concern totals rolled up with it.
   *
   * It used to be `jobs.filter(...)` per cluster on every render, with each branch
   * then reducing its own two totals — so the tree, which re-renders on every
   * navigation in the module, did O(clusters x jobs) work plus two reductions per
   * cluster for numbers that only change when the data does.
   */
  const branches = useMemo(() => {
    const byCluster = new Map<
      string,
      { jobs: TreeJob[]; open: number; critical: number }
    >();
    for (const cluster of clusters)
      byCluster.set(cluster.id, { jobs: [], open: 0, critical: 0 });
    for (const job of jobs) {
      const branch = byCluster.get(job.clusterId);
      if (!branch) continue;
      branch.jobs.push(job);
      branch.open += job.openConcerns;
      branch.critical += job.criticalConcerns;
    }
    return byCluster;
  }, [clusters, jobs]);

  return (
    <NavTreeColumn icon={Radar} title="Monitored clusters">
      {clusters.length === 0 ? (
        <NavTreeEmpty>No clusters yet.</NavTreeEmpty>
      ) : (
        clusters.map((cluster) => {
          const branch = branches.get(cluster.id);
          return (
            <ClusterBranch
              key={cluster.id}
              cluster={cluster}
              jobs={branch?.jobs ?? []}
              openConcerns={branch?.open ?? 0}
              critical={branch?.critical ?? 0}
              pathname={pathname}
            />
          );
        })
      )}

      <NavTreeAdd
        href="/admin/monitoring"
        label="Add a cluster"
        active={pathname === "/admin/monitoring"}
      />

      {/* The rubric, the playbooks and the workload types are module-wide, not
          per cluster, so they sit outside the tree. Three entries because they
          answer three questions: what is asked, how it is investigated, and what
          a workload is. */}
      <Link
        href="/admin/monitoring/checks"
        className={cn(
          "mt-4 flex w-full items-center gap-2 rounded-sm border-t border-sidebar-border px-3 pb-2 pt-4 text-body-sm text-pale-stone transition-colors hover:text-warm-off-white",
          pathname === "/admin/monitoring/checks" && "text-warm-off-white",
        )}
      >
        <ListChecks className="size-4 shrink-0 text-bone-gray" />
        <span className="truncate">Check catalogue</span>
      </Link>
      <Link
        href="/admin/monitoring/profiles"
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-body-sm text-pale-stone transition-colors hover:text-warm-off-white",
          pathname === "/admin/monitoring/profiles" && "text-warm-off-white",
        )}
      >
        <BookOpen className="size-4 shrink-0 text-bone-gray" />
        <span className="truncate">Playbooks</span>
      </Link>
      <Link
        href="/admin/monitoring/types"
        className={cn(
          "flex w-full items-center gap-2 rounded-sm px-3 py-1.5 text-body-sm text-pale-stone transition-colors hover:text-warm-off-white",
          pathname === "/admin/monitoring/types" && "text-warm-off-white",
        )}
      >
        <Boxes className="size-4 shrink-0 text-bone-gray" />
        <span className="truncate">Workload types</span>
      </Link>
    </NavTreeColumn>
  );
}

function ClusterBranch({
  cluster,
  jobs,
  openConcerns,
  critical,
  pathname,
}: {
  cluster: TreeCluster;
  jobs: TreeJob[];
  openConcerns: number;
  critical: number;
  pathname: string;
}) {
  const base = `/admin/monitoring/${cluster.id}`;
  return (
    <NavTreeBranch
      href={base}
      label={cluster.name}
      pathname={pathname}
      dot={{
        className:
          cluster.status.health !== "ok"
            ? HEALTH_DOT[cluster.status.health]
            : critical > 0
              ? "bg-traffic-red"
              : openConcerns > 0
                ? "bg-traffic-yellow"
                : "bg-traffic-green",
        title:
          cluster.status.health !== "ok"
            ? [cluster.status.summary, cluster.status.detail].filter(Boolean).join(": ")
            : `${openConcerns} open concern(s)`,
      }}
    >
      {jobs.length === 0 ? (
        <NavTreeEmptyChild>No jobs yet</NavTreeEmptyChild>
      ) : (
        jobs.map((job) => {
          const href = `${base}/jobs/${job.id}`;
          return (
            <NavTreeLeaf
              key={job.id}
              href={href}
              icon={job.type === "security" ? ShieldCheck : Gauge}
              label={job.name}
              active={pathname.startsWith(href)}
              dimmed={!job.enabled}
              badge={
                job.openConcerns > 0 && (
                  <span
                    className={cn(
                      "text-caption-tracked",
                      job.criticalConcerns > 0 ? "text-traffic-red" : "text-traffic-yellow",
                    )}
                  >
                    {job.openConcerns}
                  </span>
                )
              }
            />
          );
        })
      )}
      <NavTreeAdd
        href={`${base}/jobs/new`}
        label="New job"
        active={pathname === `${base}/jobs/new`}
        nested
      />
    </NavTreeBranch>
  );
}

/**
 * The tree's shape while its two queries run. Same 260px column and header, so
 * the content beside it does not move when the tree arrives.
 */
export function TreeSkeleton() {
  return <NavTreeSkeleton icon={Radar} title="Monitored clusters" />;
}
