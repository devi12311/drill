"use client";

import type { LineDiff, WordSegment } from "@/lib/text-diff";
import { cn } from "@/lib/utils";

/**
 * Diff rows in the house style: a monospaced +/−/~ gutter, because colour must
 * not be the only thing carrying the meaning, and the traffic palette for
 * added/removed (the gold/cobalt accents stay reserved for code). Shared by the
 * playbook comparison and the skill editor's "what Holmes changed".
 */

const DIFF_MARKER: Record<string, { glyph: string; className: string }> = {
  added: { glyph: "+", className: "text-traffic-green" },
  removed: { glyph: "−", className: "text-traffic-red" },
  changed: { glyph: "~", className: "text-traffic-yellow" },
  moved: { glyph: "↕", className: "text-bone-gray" },
};

export function Words({ segments }: { segments: WordSegment[] }) {
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

export function DiffRow({
  kind,
  position,
  children,
}: {
  kind: keyof typeof DIFF_MARKER;
  /** 1-based position in the new text, so a changed step can be found by eye. */
  position?: number;
  children: React.ReactNode;
}) {
  const marker = DIFF_MARKER[kind];
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

/** Only what changed, with the unchanged lines counted rather than shown. */
export function LineChanges({ diff, numbered }: { diff: LineDiff; numbered: boolean }) {
  const unchanged = diff.ops.filter((op) => op.kind === "same").length;
  return (
    <>
      <ul className="space-y-1.5">
        {diff.ops.map((op, i) => {
          if (op.kind === "same") return null;
          return (
            <DiffRow
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
            </DiffRow>
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
