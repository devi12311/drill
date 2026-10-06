"use client";

import { useState } from "react";
import { GroupTile } from "@/components/monitoring/group-tile";
import {
  SEVERITY_CLASS,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
} from "@/lib/monitoring/ui";
import type { Severity } from "@/lib/monitoring/types";

export interface SeverityGroup {
  count: number;
  /** One quiet line under the count — "2 new". */
  detail?: string;
  /** The group's rows, rendered only while the group is selected. */
  content: React.ReactNode;
}

/**
 * A finding list folded into five severity tiles; one group is shown at a time.
 *
 * The flat list grew one card per failing check, so a cluster job with fifty
 * checks was fifty cards before the run history — and the info-level noise sat
 * on the same page-length as the one critical. The tiles keep the distribution
 * readable at a glance, and the rows only for the group you asked for.
 *
 * `content` is a ReactNode rather than a render prop so a server page can hand
 * its already-rendered rows across the client boundary unchanged.
 *
 * Selection is local state, not a URL param: it is a view toggle, and pushing
 * history for every tile click would make Back walk through them.
 */
export function SeverityGroups({
  groups,
}: {
  groups: Partial<Record<Severity, SeverityGroup>>;
}) {
  const present = SEVERITY_ORDER.filter((s) => (groups[s]?.count ?? 0) > 0);
  const [picked, setPicked] = useState<Severity | null>(null);
  // Falls back to the worst group when nothing is picked yet, or when the picked
  // group just emptied (its last concern was marked fixed) — otherwise acting on
  // a card would leave the operator looking at a blank panel.
  const selected =
    picked && present.includes(picked) ? picked : (present[0] ?? null);

  if (!selected) return null;
  // Reserve the detail line only when some tile uses it, so the tiles stay level
  // without carrying an empty row on pages that never fill it.
  const hasDetail = present.some((s) => groups[s]?.detail);

  return (
    <div className="space-y-3">
      <div
        className="grid grid-cols-3 gap-2 sm:grid-cols-5"
        role="group"
        aria-label="Filter by severity"
      >
        {SEVERITY_ORDER.map((severity) => {
          const group = groups[severity];
          return (
            <GroupTile
              key={severity}
              label={SEVERITY_LABEL[severity]}
              count={group?.count ?? 0}
              active={severity === selected}
              railClass={SEVERITY_CLASS[severity]}
              onSelect={() => setPicked(severity)}
            >
              {hasDetail && (
                <span className="min-h-[1lh] text-caption-tracked text-bone-gray">
                  {group?.detail}
                </span>
              )}
            </GroupTile>
          );
        })}
      </div>

      {groups[selected]?.content}
    </div>
  );
}
