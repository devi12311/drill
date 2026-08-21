"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SEVERITIES, type Severity } from "@/lib/monitoring/types";
import { SEVERITY_LABEL } from "@/lib/monitoring/ui";
import type { CheckRubricItem } from "@/lib/monitoring/types";

export interface CheckOverride {
  checkId: string;
  enabled: boolean;
  severityOverride: Severity | null;
}

/**
 * Per-job view of the rubric: which checks run, and at what severity. Defaults
 * to the catalogue for everything, so an untouched job simply follows it — a job
 * that stored "inherit" rows would silently pin today's catalogue instead.
 */
export function RubricEditor({
  checks,
  overrides,
  onChange,
}: {
  checks: CheckRubricItem[];
  overrides: CheckOverride[];
  onChange: (next: CheckOverride[]) => void;
}) {
  // Memoised: this is rebuilt while rendering ~180 rows, each of which reads it.
  const byId = useMemo(
    () => new Map(overrides.map((o) => [o.checkId, o])),
    [overrides],
  );

  function set(checkId: string, patch: Partial<CheckOverride>) {
    const current: CheckOverride =
      byId.get(checkId) ?? { checkId, enabled: true, severityOverride: null };
    const next = { ...current, ...patch };
    const rest = overrides.filter((o) => o.checkId !== checkId);
    // Only keep rows that actually deviate.
    onChange(
      next.enabled && next.severityOverride === null ? rest : [...rest, next],
    );
  }

  const disabledCount = checks.filter(
    (c) => byId.get(c.id)?.enabled === false,
  ).length;
  const reratedCount = checks.filter((c) =>
    Boolean(byId.get(c.id)?.severityOverride),
  ).length;

  /**
   * The list renders only once it is opened.
   *
   * The counts are what most visits need — "124 of 176 checks · 3 disabled" is the
   * answer to "what will this cost me and what will it look at". The rows are a
   * hundred-and-eighty checkboxes and a hundred-and-eighty selects, and they were
   * being rendered, hydrated and serialised into the RSC payload on every visit to
   * either job route whether or not anyone opened them. The summary above stays
   * honest either way, because it is computed from the same data.
   */
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-body-sm text-bone-gray transition-colors hover:text-warm-off-white"
      >
        <ChevronRight
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span>
          {checks.length - disabledCount} of {checks.length} checks
          {disabledCount > 0 && ` · ${disabledCount} disabled`}
          {reratedCount > 0 && ` · ${reratedCount} re-rated`}
        </span>
        <span className="ml-auto text-caption-tracked uppercase">
          {open ? "hide" : "review and tune"}
        </span>
      </button>

      {open && (
      <div className="max-h-[420px] divide-y divide-border/60 overflow-y-auto rounded-lg border border-border">
        {checks.map((check) => {
          const override = byId.get(check.id);
          const enabled = override?.enabled !== false;
          const severity = override?.severityOverride ?? check.baseSeverity;
          const rerated = Boolean(override?.severityOverride);
          return (
            <div
              key={check.id}
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2",
                !enabled && "opacity-50",
              )}
            >
              <Checkbox
                checked={enabled}
                onCheckedChange={(value) =>
                  set(check.id, { enabled: value === true })
                }
                aria-label={`Run ${check.id}`}
              />
              <span className="font-mono text-[12px] text-muted-cobalt">
                {check.id}
              </span>
              <span className="min-w-0 flex-1 text-body-sm text-pale-stone">
                {check.title}
              </span>
              {check.requires && (
                <span className="text-caption-tracked text-bone-gray">
                  needs {check.requires}
                </span>
              )}
              <label className="flex items-center gap-1.5">
                <span className="sr-only">Severity for {check.id}</span>
                <select
                  value={severity}
                  disabled={!enabled}
                  onChange={(e) =>
                    set(check.id, {
                      severityOverride:
                        e.target.value === check.baseSeverity
                          ? null
                          : (e.target.value as Severity),
                    })
                  }
                  className={cn(
                    "h-7 rounded-sm border border-input bg-transparent px-1.5 text-caption-tracked uppercase outline-none focus-visible:border-ring disabled:cursor-not-allowed",
                    rerated ? "text-warm-off-white" : "text-bone-gray",
                  )}
                >
                  {SEVERITIES.map((option) => (
                    <option key={option} value={option} className="bg-popover">
                      {SEVERITY_LABEL[option]}
                    </option>
                  ))}
                </select>
              </label>
              {rerated && (
                <span
                  className="text-caption-tracked text-bone-gray"
                  title={`The catalogue rates this ${check.baseSeverity}`}
                >
                  was {check.baseSeverity}
                </span>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
