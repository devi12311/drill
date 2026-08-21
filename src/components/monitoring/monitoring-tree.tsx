"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import {
  BookOpen,
  ChevronRight,
  Gauge,
  ListChecks,
  Plus,
  Radar,
  ShieldCheck,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
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
  discoveryError: string | null;
}

/**
 * The monitoring module's own navigation column: registered clusters as
 * collapsible roots, their monitoring jobs as children. Sits between the admin
 * sidebar and the page content and mirrors that sidebar's frame (260px, Smoked
 * Onyx, hairline border) so the two read as one product.
 *
 * Rows deliberately restate `SideNavLink`'s visual language rather than reusing
 * it: nav links are single-level anchors, while these need indentation, a
 * disclosure control and a concern-count badge.
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
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-5 pb-3 pt-5">
        <Radar className="size-4 text-bone-gray" />
        <span className="text-caption-tracked uppercase text-bone-gray">
          Monitored clusters
        </span>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {clusters.length === 0 ? (
          <p className="px-3 py-2 text-body-sm text-bone-gray">
            No clusters yet.
          </p>
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

        <Link
          href="/admin/monitoring"
          className={cn(
            "mt-2 flex w-full items-center gap-2 rounded-sm px-3 py-2 text-body-sm text-pale-stone transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white",
            pathname === "/admin/monitoring" &&
              "bg-smoke-charcoal text-warm-off-white",
          )}
        >
          <Plus className="size-4 shrink-0 text-bone-gray" />
          <span className="truncate">Add a cluster</span>
        </Link>

        {/* The rubric and the playbooks are module-wide, not per cluster, so they
            sit outside the tree. Two entries because they answer two different
            questions: what is asked, and how it is investigated. */}
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
      </nav>
    </aside>
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
  const insideCluster = pathname.startsWith(base);
  /**
   * Opens when you navigate into the cluster, and stays wherever you put it after
   * that. The state was previously pinned open by `open || insideCluster`, which
   * meant the branch you were working in was the one branch you could not collapse
   * — the trigger moved the state and the `||` overrode it. Keyed on the cluster
   * you are inside instead, so entering re-opens it without holding it open.
   */
  const [open, setOpen] = useState(insideCluster);
  const [openedFor, setOpenedFor] = useState(insideCluster);
  if (insideCluster !== openedFor) {
    setOpenedFor(insideCluster);
    if (insideCluster) setOpen(true);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-sm pr-2 transition-colors hover:bg-smoke-charcoal",
          pathname === base && "bg-smoke-charcoal",
        )}
      >
        <CollapsibleTrigger
          aria-label={open ? "Collapse cluster" : "Expand cluster"}
          className="flex size-6 shrink-0 items-center justify-center text-bone-gray hover:text-warm-off-white"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform",
              (open || insideCluster) && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        <Link
          href={base}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-2 text-body-sm",
            pathname === base
              ? "text-warm-off-white"
              : "text-pale-stone hover:text-warm-off-white",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              cluster.discoveryError
                ? "bg-traffic-yellow"
                : critical > 0
                  ? "bg-traffic-red"
                  : openConcerns > 0
                    ? "bg-traffic-yellow"
                    : "bg-traffic-green",
            )}
            title={
              cluster.discoveryError
                ? "Discovery is failing"
                : `${openConcerns} open concern(s)`
            }
          />
          <span className="truncate">{cluster.name}</span>
        </Link>
      </div>

      <CollapsibleContent className="pb-1">
        {jobs.length === 0 ? (
          <p className="py-1.5 pl-9 text-body-sm text-bone-gray">No jobs yet</p>
        ) : (
          jobs.map((job) => {
            const href = `${base}/jobs/${job.id}`;
            const active = pathname.startsWith(href);
            const Icon = job.type === "security" ? ShieldCheck : Gauge;
            return (
              <Link
                key={job.id}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm py-1.5 pl-9 pr-2 text-body-sm transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white",
                  active
                    ? "bg-smoke-charcoal text-warm-off-white"
                    : "text-pale-stone",
                )}
              >
                <Icon
                  className={cn(
                    "size-3.5 shrink-0",
                    active ? "text-warm-off-white" : "text-bone-gray",
                  )}
                />
                <span className={cn("truncate", !job.enabled && "opacity-60")}>
                  {job.name}
                </span>
                {job.openConcerns > 0 && (
                  <span
                    className={cn(
                      "ml-auto shrink-0 text-caption-tracked",
                      job.criticalConcerns > 0
                        ? "text-traffic-red"
                        : "text-traffic-yellow",
                    )}
                  >
                    {job.openConcerns}
                  </span>
                )}
              </Link>
            );
          })
        )}
        <Link
          href={`${base}/jobs/new`}
          className={cn(
            "flex w-full items-center gap-2 rounded-sm py-1.5 pl-9 pr-2 text-body-sm text-bone-gray transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white",
            pathname === `${base}/jobs/new` &&
              "bg-smoke-charcoal text-warm-off-white",
          )}
        >
          <Plus className="size-3.5 shrink-0" />
          <span className="truncate">New job</span>
        </Link>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The tree's shape while its two queries run. Same 260px column and header, so
 * the content beside it does not move when the tree arrives.
 */
export function TreeSkeleton() {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-5 pb-3 pt-5">
        <Radar className="size-4 text-bone-gray" />
        <span className="text-caption-tracked uppercase text-bone-gray">
          Monitored clusters
        </span>
      </div>
      <div className="space-y-2 px-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7" />
        ))}
      </div>
    </aside>
  );
}
