"use client";

import type { ObservationDiff, PlaybookDiff } from "@/lib/monitoring/playbook-diff";
import { diffWords } from "@/lib/text-diff";
import { DiffRow, LineChanges, Words } from "@/components/ui/text-diff";
import { OBSERVATION_SOURCE_LABEL } from "@/lib/monitoring/ui";
import type { ObservationSpec } from "@/lib/monitoring/playbook";
import { cn } from "@/lib/utils";

/**
 * Renders a method comparison.
 *
 * Two decisions shape it. First, it shows **only what changed** — no context lines. A
 * ClickHouse diff is eight new steps and twenty-one new measurements against text that
 * is already two screens long, and padding that with unchanged lines is what made the
 * first version of this unreadable. The unchanged count is stated instead.
 *
 * Second, the marker gutter is monospaced +/−/~ rather than colour alone: colour
 * carries the meaning fastest but must not be the only thing carrying it, and a
 * terminal-shaped diff is also the house style (DESIGN.md). Added and removed use the
 * traffic palette already established for severity and run status; the gold/cobalt
 * accents stay reserved for code, which this is not.
 */

/** A one-line "what changed", reused in the page's overview strip. */
export function DiffHeadline({
  diff,
  className,
}: {
  diff: PlaybookDiff;
  className?: string;
}) {
  return (
    <span className={cn("text-body-sm text-pale-stone", className)}>
      {diff.headline}
    </span>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <p className="text-caption-tracked uppercase text-bone-gray">
        {title}
        {count && <span className="ml-2 normal-case tracking-normal">{count}</span>}
      </p>
      {children}
    </div>
  );
}

function SpecLine({ spec }: { spec: ObservationSpec }) {
  return (
    <>
      <span className="font-mono text-[12px] text-pale-stone">{spec.key}</span>
      <span className="text-caption-tracked uppercase">
        {" "}
        {OBSERVATION_SOURCE_LABEL[spec.source] ?? spec.source}
        {spec.unit && <span className="normal-case"> · {spec.unit}</span>}
      </span>
      <span> — {spec.how}</span>
    </>
  );
}

function ObservationChanges({ diff }: { diff: ObservationDiff }) {
  return (
    <>
      <ul className="space-y-1.5">
        {diff.added.map((spec) => (
          <DiffRow key={`a-${spec.key}`} kind="added">
            <SpecLine spec={spec} />
          </DiffRow>
        ))}
        {diff.removed.map((spec) => (
          <DiffRow key={`r-${spec.key}`} kind="removed">
            <span className="font-mono text-[12px]">{spec.key}</span>
            <span> — no longer measured; readings already taken are kept</span>
          </DiffRow>
        ))}
        {diff.changed.map((change) => (
          <DiffRow key={`c-${change.after.key}`} kind="changed">
            <span className="font-mono text-[12px] text-pale-stone">
              {change.after.key}
            </span>
            <span className="ml-2">
              {change.fields
                .filter((field) => field !== "how")
                .map((field) => (
                  <span key={field} className="mr-2">
                    {field}:{" "}
                    {/* An empty unit is normal, so name it rather than rendering a
                        struck-through dash that reads as punctuation. */}
                    <span
                      className={cn(
                        "text-traffic-red",
                        change.before[field] && "line-through",
                      )}
                    >
                      {change.before[field] || "(none)"}
                    </span>{" "}
                    <span className="text-bone-gray">→</span>{" "}
                    <span className="text-traffic-green">
                      {change.after[field] || "(none)"}
                    </span>
                  </span>
                ))}
            </span>
            {change.fields.includes("how") && (
              <span className="block">
                <Words segments={diffWords(change.before.how, change.after.how)} />
              </span>
            )}
          </DiffRow>
        ))}
        {diff.moved.length > 0 && (
          <DiffRow kind="moved">
            {diff.moved.length} measurement
            {diff.moved.length === 1 ? "" : "s"} asked in a different order:{" "}
            <span className="font-mono text-[12px] text-pale-stone">
              {diff.moved.join(", ")}
            </span>
          </DiffRow>
        )}
      </ul>
      {diff.unchanged > 0 && (
        <p className="pl-6 text-body-sm text-bone-gray/70">
          {diff.unchanged} unchanged
        </p>
      )}
    </>
  );
}

export function PlaybookDiffPanel({
  diff,
  beforeLabel,
}: {
  diff: PlaybookDiff;
  /** What the current text is being compared against, e.g. "shipped v2". */
  beforeLabel: string;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-smoked-onyx/40 p-3">
      <p className="text-body-sm text-warm-off-white">
        Compared with {beforeLabel} — <DiffHeadline diff={diff} />
      </p>

      {diff.framing && (
        <Section title="Framing">
          <p className="max-w-[90ch] text-body-sm text-bone-gray">
            <Words segments={diff.framing} />
          </p>
        </Section>
      )}

      {diff.dataSources && (
        <Section title="Where the data is">
          <LineChanges diff={diff.dataSources} numbered={false} />
        </Section>
      )}

      {diff.method && (
        <Section title="How to investigate">
          <LineChanges diff={diff.method} numbered />
        </Section>
      )}

      {diff.observations && (
        <Section title="Measurements">
          <ObservationChanges diff={diff.observations} />
        </Section>
      )}
    </div>
  );
}
