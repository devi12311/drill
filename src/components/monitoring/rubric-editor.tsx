"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { SEVERITIES, type Severity } from "@/lib/monitoring/types";
import type { CheckView } from "@/lib/monitoring/types";

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
  checks: CheckView[];
  overrides: CheckOverride[];
  onChange: (next: CheckOverride[]) => void;
}) {
  const byId = new Map(overrides.map((o) => [o.checkId, o]));

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

  return (
    <div className="space-y-2">
      <p className="text-body-sm text-bone-gray">
        {checks.length - disabledCount} of {checks.length} checks
        {disabledCount > 0 && ` · ${disabledCount} disabled`}
        {reratedCount > 0 && ` · ${reratedCount} re-rated`}
      </p>

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
                      {option}
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
    </div>
  );
}
