"use client";

import {
  diffWords,
  type LineDiff,
  type ObservationDiff,
  type PlaybookDiff,
  type WordSegment,
} from "@/lib/monitoring/playbook-diff";
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

const MARKER: Record<string, { glyph: string; className: string }> = {
  added: { glyph: "+", className: "text-traffic-green" },
  removed: { glyph: "−", className: "text-traffic-red" },
  changed: { glyph: "~", className: "text-traffic-yellow" },
  moved: { glyph: "↕", className: "text-bone-gray" },
};

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

function Words({ segments }: { segments: WordSegment[] }) {
  return (
    <span>
      {segments.map((segment, i) =>
        segment.kind === "same" ? (
          <span key={i}>{segment.text} </span>
        ) : (
          <span
            key={i}
            className={cn(
              "rounded-sm px-0.5",
              segment.kind === "added"
                ? "bg-traffic-green/15 text-traffic-green"
                : "bg-traffic-red/15 text-traffic-red line-through",
            )}
          >
            {segment.text}{" "}
          </span>
        ),
      )}
    </span>
  );
}

function Row({
  kind,
  position,
  children,
}: {
  kind: keyof typeof MARKER;
  /** 1-based position in the new text, so a changed step can be found by eye. */
  position?: number;
  children: React.ReactNode;
}) {
  const marker = MARKER[kind];
  return (
    <li className="flex gap-2">
      <span
        className={cn(
          "w-4 shrink-0 pt-0.5 text-center font-mono text-[12px]",
          marker.className,
        )}
        aria-label={kind}
      >
        {marker.glyph}
      </span>
      {position !== undefined && (
        <span className="w-6 shrink-0 pt-0.5 text-right font-mono text-[12px] text-bone-gray">
          {position}.
        </span>
      )}
      <span className="min-w-0 flex-1 text-body-sm text-bone-gray">{children}</span>
    </li>
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

function LineChanges({ diff, numbered }: { diff: LineDiff; numbered: boolean }) {
  const unchanged = diff.ops.filter((op) => op.kind === "same").length;
  return (
    <>
      <ul className="space-y-1.5">
        {diff.ops.map((op, i) => {
          if (op.kind === "same") return null;
          return (
            <Row
              key={i}
              kind={op.kind}
              position={
                numbered && op.kind !== "removed" ? op.index + 1 : undefined
              }
            >
              {/* `words` is only built for a detailed diff; the panel always asks
                  for one, so the fallback is defence rather than a real case. */}
              {op.kind === "changed" && op.words ? (
                <Words segments={op.words} />
              ) : (
                op.text
              )}
            </Row>
          );
        })}
      </ul>
      {unchanged > 0 && (
        <p className="pl-6 text-body-sm text-bone-gray/70">
          {unchanged} unchanged
        </p>
      )}
    </>
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
          <Row key={`a-${spec.key}`} kind="added">
            <SpecLine spec={spec} />
          </Row>
        ))}
        {diff.removed.map((spec) => (
          <Row key={`r-${spec.key}`} kind="removed">
            <span className="font-mono text-[12px]">{spec.key}</span>
            <span> — no longer measured; readings already taken are kept</span>
          </Row>
        ))}
        {diff.changed.map((change) => (
          <Row key={`c-${change.after.key}`} kind="changed">
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
          </Row>
        ))}
        {diff.moved.length > 0 && (
          <Row kind="moved">
            {diff.moved.length} measurement
            {diff.moved.length === 1 ? "" : "s"} asked in a different order:{" "}
            <span className="font-mono text-[12px] text-pale-stone">
              {diff.moved.join(", ")}
            </span>
          </Row>
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
