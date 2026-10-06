"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { SOURCE_LABEL } from "@/lib/monitoring/catalogue-scope";
import {
  DefinitionGrid,
  DefinitionTile,
} from "@/components/monitoring/definition-grid";
import { GroupTile } from "@/components/monitoring/group-tile";
import {
  SEVERITY_CLASS,
  SEVERITY_LABEL,
  SEVERITY_ORDER,
  bySeverity,
} from "@/lib/monitoring/ui";
import {
  CLUSTER_TECHNOLOGY,
  type CheckListItem,
  type Severity,
} from "@/lib/monitoring/types";
import { useTechnologies } from "@/components/monitoring/technologies-provider";

/** A check with no technology list reaches every workload — its own shelf. */
const ANY = "any";


/**
 * The one word a tile carries, most actionable first: off, then a template change
 * the org has not looked at, then where the check comes from (decision 126), then
 * its version.
 */
function tileMarker(check: CheckListItem): string | undefined {
  if (!check.enabled) return "disabled";
  if (check.updateAvailable) return "update";
  if (check.source !== "template") return SOURCE_LABEL[check.source];
  return check.version > 1 ? `v${check.version}` : undefined;
}

/** The catalogue's tile for one check — shared by the shelves and the search results. */
export function CheckTiles({
  checks,
  onOpen,
}: {
  checks: CheckListItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <DefinitionGrid>
      {checks.map((check) => (
        <DefinitionTile
          key={check.id}
          id={check.id}
          title={check.title}
          caption={check.id}
          railClass={SEVERITY_CLASS[check.baseSeverity]}
          marker={tileMarker(check)}
          dimmed={!check.enabled}
          onOpen={onOpen}
        />
      ))}
    </DefinitionGrid>
  );
}

/**
 * One category's checks, shelved by technology: a tile per technology, and the
 * open shelf's checks beneath, narrowed further by severity chips.
 *
 * Technology rather than severity because it is how a check is looked up — "what
 * do we ask of PostgreSQL?" — and how jobs are scoped, so the shelves answer the
 * question a job author is actually asking. It also scales: a growing catalogue
 * adds shelves, and no one shelf approaches the 160-tile wall this replaced.
 *
 * A check scoped to several technologies sits on each of their shelves, so the
 * shelf counts can sum past the category total. That is the honest answer to
 * "what runs against MySQL", which is what each count claims to be.
 *
 * Shelf and severity are local state: the open definition already owns the URL,
 * and these are view toggles nobody links to.
 */
export function TechnologyShelves({
  checks,
  onOpen,
}: {
  checks: CheckListItem[];
  onOpen: (id: string) => void;
}) {
  const { all, label } = useTechnologies();
  const shelfLabel = (key: string) => (key === ANY ? "Any technology" : label(key));
  const shelves = useMemo(() => {
    // The cluster first, since it is its own kind of job; then the org's workload
    // types in priority order; "any technology" last, as the catch-all.
    const known = [
      CLUSTER_TECHNOLOGY,
      ...all.map((t) => t.slug).filter((t) => t !== CLUSTER_TECHNOLOGY),
      ANY,
    ];
    const byShelf = new Map<string, CheckListItem[]>();
    for (const check of checks) {
      for (const key of check.technologies.length > 0
        ? check.technologies
        : [ANY]) {
        const shelf = byShelf.get(key);
        if (shelf) shelf.push(check);
        else byShelf.set(key, [check]);
      }
    }
    // Unknown technologies (a check naming a type that no longer exists) still
    // get a shelf, after the known ones, rather than vanishing.
    const order = [
      ...known,
      ...[...byShelf.keys()].filter((k) => !known.includes(k)).sort(),
    ];
    return order
      .filter((key) => byShelf.has(key))
      .map((key) => {
        const members = byShelf.get(key)!;
        return { key, members, severities: bySeverity(members, (c) => c.baseSeverity) };
      });
  }, [checks, all]);

  const [picked, setPicked] = useState<string | null>(null);
  const [severity, setSeverity] = useState<Severity | null>(null);
  // Falls back to the first shelf when nothing is picked, or when the picked
  // shelf emptied after an edit moved its last check elsewhere.
  const open = shelves.find((s) => s.key === picked) ?? shelves[0];
  if (!open) return null;

  // A single shelf is a heading, not a choice — skip straight to its checks.
  if (shelves.length === 1) return <CheckTiles checks={open.members} onOpen={onOpen} />;

  const shown =
    severity && open.severities.has(severity)
      ? open.severities.get(severity)!
      : open.members;
  const activeSeverity = shown === open.members ? null : severity;

  return (
    <div className="space-y-4">
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
        role="group"
        aria-label="Technology"
      >
        {shelves.map((shelf) => (
          <GroupTile
            key={shelf.key}
            label={shelfLabel(shelf.key)}
            count={shelf.members.length}
            active={shelf === open}
            onSelect={() => {
              setPicked(shelf.key);
              // A severity chosen on one shelf means nothing on the next.
              setSeverity(null);
            }}
          >
            <SeverityBar severities={shelf.severities} />
          </GroupTile>
        ))}
      </div>

      <div className="space-y-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Severity"
        >
          <Chip active={activeSeverity === null} onClick={() => setSeverity(null)}>
            All {open.members.length}
          </Chip>
          {SEVERITY_ORDER.filter((s) => open.severities.has(s)).map((s) => (
            <Chip
              key={s}
              active={activeSeverity === s}
              onClick={() => setSeverity(s)}
            >
              <span className={SEVERITY_CLASS[s]}>{SEVERITY_LABEL[s]}</span>{" "}
              {open.severities.get(s)!.length}
            </Chip>
          ))}
        </div>
        <CheckTiles checks={shown} onOpen={onOpen} />
      </div>
    </div>
  );
}

/**
 * The shelf's severity mix as one 4px stacked bar, worst first.
 *
 * Colour alone never carries it: the same counts are spelled out in the tooltip,
 * for screen readers, and on the chips once the shelf is open. Critical and high
 * share the traffic red (see `SEVERITY_CLASS`), so high is drawn at half
 * strength — the same filled-versus-outlined split the badges use.
 */
function SeverityBar({ severities }: { severities: Map<Severity, CheckListItem[]> }) {
  const parts = SEVERITY_ORDER.filter((s) => severities.has(s)).map((s) => ({
    severity: s,
    count: severities.get(s)!.length,
  }));
  const summary = parts
    .map((p) => `${p.count} ${SEVERITY_LABEL[p.severity].toLowerCase()}`)
    .join(" · ");
  return (
    <span className="mt-1 flex h-1 w-full gap-[2px]" title={summary}>
      <span className="sr-only">{summary}</span>
      {parts.map((p) => (
        <span
          key={p.severity}
          aria-hidden
          style={{ flexGrow: p.count }}
          className={cn(
            "rounded-full bg-current",
            SEVERITY_CLASS[p.severity],
            p.severity === "high" && "opacity-50",
          )}
        />
      ))}
    </span>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-7 rounded-sm border px-2.5 text-body-sm tabular-nums transition-colors",
        "focus-visible:border-ring focus-visible:outline-none",
        active
          ? "border-warm-off-white/40 bg-smoke-charcoal text-warm-off-white"
          : "border-border text-bone-gray hover:border-input hover:text-warm-off-white",
      )}
    >
      {children}
    </button>
  );
}
