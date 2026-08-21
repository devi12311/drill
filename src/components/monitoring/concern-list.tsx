"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ConcernCard,
  type ConcernCheckInfo,
  type ConcernView,
} from "@/components/monitoring/concern-card";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";

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
        <div className="space-y-2">
          {concerns.map((concern) => (
            <ConcernCard
              key={concern.id}
              concern={concern}
              check={checkInfo[concern.checkId]}
              onChanged={() => refresh(null)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
