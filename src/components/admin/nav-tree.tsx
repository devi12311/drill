"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Plus, type LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The building blocks of an admin module's own navigation column (Monitoring:
 * clusters → jobs; Git: connections → repositories). It sits between the admin
 * sidebar and the page content and mirrors that sidebar's frame (260px, Smoked
 * Onyx, hairline border) so the two read as one product.
 *
 * Rows deliberately restate `SideNavLink`'s visual language rather than reusing
 * it: nav links are single-level anchors, while these need indentation, a
 * disclosure control and a status dot or count badge.
 */

function ColumnHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-3 pt-5">
      <Icon className="size-4 text-bone-gray" />
      <span className="text-caption-tracked uppercase text-bone-gray">{title}</span>
    </div>
  );
}

export function NavTreeColumn({
  icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <ColumnHeader icon={icon} title={title} />
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">{children}</nav>
    </aside>
  );
}

/** The column's shape while its queries run, so the content beside it does not move when it arrives. */
export function NavTreeSkeleton({ icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <ColumnHeader icon={icon} title={title} />
      <div className="space-y-2 px-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7" />
        ))}
      </div>
    </aside>
  );
}

export function NavTreeEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-body-sm text-bone-gray">{children}</p>;
}

/**
 * A collapsible root (a cluster, a connection) with a status dot, linking to its
 * own page and holding its children.
 */
export function NavTreeBranch({
  href,
  label,
  dot,
  pathname,
  inside = pathname.startsWith(href),
  children,
}: {
  href: string;
  label: string;
  /** Background class for the status dot, plus its tooltip. */
  dot: { className: string; title: string };
  pathname: string;
  /** Whether the current page belongs to this branch; defaults to "under its href". */
  inside?: boolean;
  children: React.ReactNode;
}) {
  /**
   * Opens when you navigate into the branch, and stays wherever you put it after
   * that. The state was previously pinned open by `open || inside`, which meant
   * the branch you were working in was the one branch you could not collapse —
   * the trigger moved the state and the `||` overrode it. Keyed on the branch you
   * are inside instead, so entering re-opens it without holding it open.
   */
  const [open, setOpen] = useState(inside);
  const [openedFor, setOpenedFor] = useState(inside);
  if (inside !== openedFor) {
    setOpenedFor(inside);
    if (inside) setOpen(true);
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "flex items-center gap-1 rounded-sm pr-2 transition-colors hover:bg-smoke-charcoal",
          pathname === href && "bg-smoke-charcoal",
        )}
      >
        <CollapsibleTrigger
          aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
          className="flex size-6 shrink-0 items-center justify-center text-bone-gray hover:text-warm-off-white"
        >
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </CollapsibleTrigger>
        <Link
          href={href}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-2 text-body-sm",
            pathname === href ? "text-warm-off-white" : "text-pale-stone hover:text-warm-off-white",
          )}
        >
          <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", dot.className)} title={dot.title} />
          <span className="truncate">{label}</span>
        </Link>
      </div>
      <CollapsibleContent className="pb-1">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/** A child row inside a branch (a job, a repository). */
export function NavTreeLeaf({
  href,
  icon: Icon,
  label,
  active,
  dimmed,
  badge,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  active: boolean;
  dimmed?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm py-1.5 pl-9 pr-2 text-body-sm transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white",
        active ? "bg-smoke-charcoal text-warm-off-white" : "text-pale-stone",
      )}
    >
      <Icon className={cn("size-3.5 shrink-0", active ? "text-warm-off-white" : "text-bone-gray")} />
      <span className={cn("truncate", dimmed && "opacity-60")}>{label}</span>
      {badge && <span className="ml-auto shrink-0">{badge}</span>}
    </Link>
  );
}

export function NavTreeEmptyChild({ children }: { children: React.ReactNode }) {
  return <p className="py-1.5 pl-9 text-body-sm text-bone-gray">{children}</p>;
}

/** "+ Add …" — at the root of the column, or nested at the foot of a branch. */
export function NavTreeAdd({
  href,
  label,
  active,
  nested,
}: {
  href: string;
  label: string;
  active: boolean;
  nested?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm text-body-sm transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white",
        nested ? "py-1.5 pl-9 pr-2 text-bone-gray" : "mt-2 px-3 py-2 text-pale-stone",
        active && "bg-smoke-charcoal text-warm-off-white",
      )}
    >
      <Plus className={cn("shrink-0", nested ? "size-3.5" : "size-4 text-bone-gray")} />
      <span className="truncate">{label}</span>
    </Link>
  );
}
