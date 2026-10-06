"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ConcernCard,
  type ConcernCheckInfo,
  type ConcernView,
} from "@/components/monitoring/concern-card";
import {
  SeverityGroups,
  type SeverityGroup,
} from "@/components/monitoring/severity-groups";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import { bySeverity } from "@/lib/monitoring/ui";
import type { Severity } from "@/lib/monitoring/types";

/**
 * The concern list, and the open/all switch above it.
 *
 * A client component only because the cards mutate: acting on a concern used to
 * refetch every concern of the job PLUS the whole check catalogue and blank the
 * page to the word "Loading…" — for a change to one card. `refresh()` re-renders
 * the page on the server and the list arrives updated, with the scroll position,
 * the other cards' expanded state and everything else left alone.
 */
export function ConcernList({
  concerns,
  checkInfo,
  showAll,
}: {
  concerns: ConcernView[];
  /** Only the checks these concerns cite — see the page for why. */
  checkInfo: Record<string, ConcernCheckInfo>;
  showAll: boolean;
}) {
  const refresh = useRefreshThenNavigate();
  const pathname = usePathname();
  const params = useSearchParams();

  const toggled = new URLSearchParams(params.toString());
  if (showAll) toggled.delete("status");
  else toggled.set("status", "all");
  const toggleQs = toggled.toString();

  // Bucketed by the severity the card shows — the effective one, after any
  // per-job or contextual re-rating.
  const groups: Partial<Record<Severity, SeverityGroup>> = {};
  for (const [severity, members] of bySeverity(
    concerns,
    (c) => c.effectiveSeverity,
  )) {
    const open = members.filter((c) => c.status === "open").length;
    groups[severity] = {
      count: members.length,
      // Only with resolved concerns included, where the count alone would
      // overstate what is still live.
      detail: showAll ? `${open} open` : undefined,
      content: (
        <div className="space-y-2">
          {members.map((concern) => (
            <ConcernCard
              key={concern.id}
              concern={concern}
              check={checkInfo[concern.checkId]}
              onChanged={() => refresh(null)}
            />
          ))}
        </div>
      ),
    };
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-body font-medium text-warm-off-white">
          {showAll ? "All concerns" : "Open concerns"}
          <span className="ml-2 text-body-sm text-bone-gray">
            {concerns.length}
          </span>
        </h2>
        {/* A link, not a state toggle: the filter is a URL param, so it is
            linkable and the resolved concerns are only ever queried when asked
            for. */}
        <Link
          href={toggleQs ? `${pathname}?${toggleQs}` : pathname}
          scroll={false}
          className="text-body-sm text-bone-gray underline-offset-4 hover:text-warm-off-white hover:underline"
        >
          {showAll ? "Show open only" : "Include resolved, muted and dismissed"}
        </Link>
      </div>

      {concerns.length === 0 ? (
        <p className="py-6 text-body-sm text-bone-gray">
          {showAll
            ? "Nothing recorded yet — run the job to produce its first assessment."
            : "No open concerns. Either this job has not run yet, or everything it checks is currently passing."}
        </p>
      ) : (
        <SeverityGroups groups={groups} />
      )}
    </section>
  );
}
