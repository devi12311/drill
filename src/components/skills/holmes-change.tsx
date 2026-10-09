"use client";

import { useState } from "react";
import { DiffRow, LineChanges, Words } from "@/components/ui/text-diff";
import { diffLines, diffWords, type LineDiff } from "@/lib/text-diff";
import type { SkillDraft, SkillInput } from "@/lib/skills/types";

export type DraftField = "name" | "description" | "inputs" | "body";

function InputChanges({ before, after }: { before: SkillInput[]; after: SkillInput[] }) {
  const old = new Map(before.map((i) => [i.key, i]));
  const now = new Map(after.map((i) => [i.key, i]));
  const describe = (i: SkillInput) => `${i.label}${i.required ? " · required" : ""}`;
  return (
    <ul className="space-y-1.5">
      {after.map((input) => {
        const was = old.get(input.key);
        if (!was)
          return (
            <DiffRow key={input.key} kind="added">
              <span className="font-mono text-[12px] text-pale-stone">{input.key}</span> — {describe(input)}
            </DiffRow>
          );
        if (was.label === input.label && was.required === input.required) return null;
        return (
          <DiffRow key={input.key} kind="changed">
            <span className="font-mono text-[12px] text-pale-stone">{input.key}</span> —{" "}
            <Words segments={diffWords(describe(was), describe(input))} />
          </DiffRow>
        );
      })}
      {before
        .filter((input) => !now.has(input.key))
        .map((input) => (
          <DiffRow key={input.key} kind="removed">
            <span className="font-mono text-[12px]">{input.key}</span> — {describe(input)}
          </DiffRow>
        ))}
    </ul>
  );
}

/** Line diff of two procedures, without blank lines coming and going — markdown spacing, not content. */
function procedureDiff(before: string, after: string): LineDiff {
  const diff = diffLines(before.split("\n"), after.split("\n"), { words: true });
  const ops = diff.ops.filter((op) => op.kind === "same" || op.kind === "changed" || op.text.trim() !== "");
  return {
    ops,
    added: ops.filter((o) => o.kind === "added").length,
    removed: ops.filter((o) => o.kind === "removed").length,
    changed: diff.changed,
  };
}

/**
 * Beside a field Holmes rewrote: the mark, what it changed, and a way back for
 * that field alone. A whole-form replace with one Undo asked the author to
 * "review before saving" a 10k-character procedure by eye; this is the review.
 * A field that was empty before has nothing to compare, so it only gets the mark.
 */
export function HolmesChange({
  field,
  before,
  after,
  onRevert,
}: {
  field: DraftField;
  before: SkillDraft;
  after: SkillDraft;
  onRevert: () => void;
}) {
  const [open, setOpen] = useState(false);
  const comparable = field === "inputs" ? before.inputs.length > 0 : before[field] !== "";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body-sm">
        <span className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 text-caption-tracked uppercase text-pale-stone">
          Holmes
        </span>
        {comparable ? (
          <>
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="text-pale-stone underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
            >
              {open ? "Hide changes" : "Show changes"}
            </button>
            <button
              type="button"
              onClick={onRevert}
              className="text-bone-gray underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
            >
              Revert to before Holmes
            </button>
          </>
        ) : (
          <span className="text-bone-gray">written by Holmes</span>
        )}
      </div>
      {open && comparable && (
        <div className="max-h-96 overflow-y-auto rounded-lg border border-border bg-smoked-onyx/40 p-3 text-body-sm text-bone-gray">
          {field === "inputs" ? (
            <InputChanges before={before.inputs} after={after.inputs} />
          ) : field === "body" ? (
            <LineChanges diff={procedureDiff(before.body, after.body)} numbered />
          ) : (
            <Words segments={diffWords(before[field], after[field])} />
          )}
        </div>
      )}
    </div>
  );
}
