"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useMediaQuery } from "@/components/ui/use-media-query";
import { useSession } from "@/components/session/session-provider";
import { showsModeSwitch } from "@/components/shell/mode-switch";
import { OutcomeDot } from "@/components/chat/investigation-rail";
import { callOutcome } from "@/lib/chat/investigations";
import { cn } from "@/lib/utils";
import { PURPOSE_LIMIT, paramPreview } from "@/lib/skills/conversation-steps";
import { SKILL_LIMITS, toInputKey } from "@/lib/skills/types";
import type { InputRow, SkillBuilder } from "./use-skill-builder";

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="text-caption-tracked uppercase text-bone-gray">
      {children}
    </h3>
  );
}

/** m:ss since `since` — a draft takes a minute or more, and silence reads as stuck. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="ml-auto shrink-0 font-mono text-[12px] tabular-nums text-bone-gray">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function Steps({
  builder,
  onReveal,
  titleId,
}: {
  builder: SkillBuilder;
  onReveal: (key: string) => void;
  titleId: string;
}) {
  const busy = builder.phase.name === "generating";
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <SectionTitle id={titleId}>Steps · {builder.picked.length}</SectionTitle>
      {builder.picked.length === 0 ? (
        <p className="text-body-sm text-bone-gray">
          Add the calls that moved the investigation forward — skip lookups and dead
          ends. Steps keep conversation order.
        </p>
      ) : (
        <ol className="space-y-2">
          {builder.picked.map((step) => {
            const preview = paramPreview(step.call);
            return (
              <li
                key={step.key}
                className="flex items-start gap-1 rounded-lg border border-border hover:bg-iron-veil/40"
              >
                <button
                  type="button"
                  onClick={() => onReveal(step.key)}
                  className="min-w-0 flex-1 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  aria-label={`Show step ${step.number}, ${step.call.tool_name}, in the conversation`}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[12px] tabular-nums text-bone-gray">
                      {step.number}
                    </span>
                    <span className="truncate font-mono text-[13px] text-warm-off-white">
                      {step.call.tool_name}
                    </span>
                    {callOutcome(step.call) !== "ok" && <OutcomeDot call={step.call} />}
                  </span>
                  {step.call.description && (
                    <span className="mt-0.5 block truncate text-body-sm text-bone-gray">
                      {step.call.description}
                    </span>
                  )}
                  {preview && (
                    <span className="mt-0.5 block truncate font-mono text-[12px] text-muted-cobalt">
                      {preview}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => builder.toggle(step.key)}
                  aria-label={`Remove step ${step.number}`}
                  className="m-1 inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-bone-gray outline-none hover:text-traffic-red focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function InputLine({ row, builder }: { row: InputRow; builder: SkillBuilder }) {
  const busy = builder.phase.name === "generating";
  const error = builder.inputErrors[row.id];
  const errorId = `${row.id}-error`;
  // Two lines: the value as it was used, then the key it becomes — side by side,
  // a long id leaves the key no room in a 360px rail.
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {row.detected ? (
          <>
            <Checkbox
              checked={row.enabled}
              onCheckedChange={(v) => builder.setInputEnabled(row, v === true)}
              disabled={busy}
              aria-label={`Make ${row.value} an input`}
            />
            <span
              title={row.value}
              className={cn(
                "min-w-0 flex-1 truncate font-mono text-[12px]",
                row.enabled ? "text-pale-stone" : "text-bone-gray line-through",
              )}
            >
              {row.value}
            </span>
          </>
        ) : (
          <>
            <span className="size-4 shrink-0" />
            <Input
              value={row.value}
              onChange={(e) => builder.setInputValue(row, e.target.value)}
              maxLength={SKILL_LIMITS.inputValue}
              placeholder="value used here (optional)"
              aria-label="Value used in this conversation"
              disabled={busy}
              className="h-8 min-w-0 flex-1 font-mono text-[12px]"
            />
            <button
              type="button"
              onClick={() => builder.removeInput(row)}
              disabled={busy}
              aria-label={`Remove input ${row.key || "row"}`}
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-bone-gray outline-none hover:text-traffic-red focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 pl-6">
        <span aria-hidden className="text-bone-gray">→</span>
        <Input
          value={row.key}
          onChange={(e) => builder.setInputKey(row, toInputKey(e.target.value))}
          placeholder="key, e.g. user_id"
          aria-label={row.detected ? `Input key for ${row.value}` : "Input key"}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={busy || !row.enabled}
          className="h-8 min-w-0 flex-1 font-mono text-[12px]"
        />
      </div>
      {row.detected && (
        <p className="pl-6 text-[12px] text-bone-gray">
          in your question · {row.steps.length === 1 ? "step" : "steps"}{" "}
          {row.steps.join(", ")}
        </p>
      )}
      {error && (
        <p id={errorId} className="pl-6 text-[12px] text-traffic-red">
          {error}
        </p>
      )}
    </div>
  );
}

function Inputs({ builder, titleId }: { builder: SkillBuilder; titleId: string }) {
  const busy = builder.phase.name === "generating";
  return (
    <section aria-labelledby={titleId} className="space-y-3">
      <SectionTitle id={titleId}>Inputs</SectionTitle>
      <p className="text-body-sm text-bone-gray">
        {builder.inputs.some((i) => i.detected)
          ? "Values from your questions that the steps reuse. Each becomes a placeholder you fill in when running the skill."
          : "No values from your questions appear in these steps."}
      </p>
      {builder.inputs.map((row) => (
        <InputLine key={row.id} row={row} builder={builder} />
      ))}
      {builder.inputs.length < SKILL_LIMITS.inputs && (
        <button
          type="button"
          onClick={builder.addInput}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-body-sm text-bone-gray outline-none hover:text-warm-off-white focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-3.5" />
          add input
        </button>
      )}
    </section>
  );
}

/** Where the rail sits beside the conversation; narrower, it is a bar and a dialog. */
const WIDE = "(min-width: 1280px)";

/**
 * The rail beside the conversation where both fit (xl and up); below that, the
 * dialog the bar opens once picking is done.
 */
export function SkillBuilderPanel({ builder }: { builder: SkillBuilder }) {
  const wide = useMediaQuery(WIDE);
  const { user } = useSession();
  if (wide) {
    return (
      <aside
        aria-label="Skill builder"
        className="flex h-full w-[360px] shrink-0 flex-col border-l border-border bg-smoked-onyx"
      >
        <SkillBuilderRail
          builder={builder}
          onReveal={builder.reveal}
          onClose={builder.stop}
          closeLabel="Close the skill builder"
          // The aside reaches the bottom-right corner, where the mode island sits.
          clearCorner={showsModeSwitch(user)}
        />
      </aside>
    );
  }
  return (
    <Dialog open={builder.reviewOpen} onOpenChange={builder.setReviewOpen}>
      <DialogContent size="md" showCloseButton={false} className="h-[85dvh] gap-0 p-0">
        <DialogTitle className="sr-only">New skill from this conversation</DialogTitle>
        <SkillBuilderRail
          builder={builder}
          // A step card leads back to the conversation, so the dialog gives way first.
          onReveal={(key) => {
            builder.setReviewOpen(false);
            requestAnimationFrame(() => builder.reveal(key));
          }}
          onClose={() => builder.setReviewOpen(false)}
          closeLabel="Back to picking steps"
        />
      </DialogContent>
    </Dialog>
  );
}

/** Narrow screens: in the composer's place while picking, it opens the rail. */
export function SkillBuilderBar({ builder }: { builder: SkillBuilder }) {
  const wide = useMediaQuery(WIDE);
  if (wide) return null;
  const count = builder.picked.length;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-smoked-onyx px-4 py-3">
      <p className="text-body-sm text-pale-stone">
        {count === 0 ? "Add the calls that mattered" : `${plural(count, "step")} picked`}
      </p>
      <div className="flex shrink-0 gap-2">
        <Button variant="ghost" size="sm" onClick={builder.stop}>
          Cancel
        </Button>
        <Button variant="secondary" size="sm" onClick={() => builder.setReviewOpen(true)}>
          Review ▸
        </Button>
      </div>
    </div>
  );
}

/**
 * The skill builder's panel: the picked steps, the inputs and the purpose, then
 * Generate. Presentational — the state lives in `useSkillBuilderState`, so the
 * wide-screen aside and the narrow-screen dialog show the same selection.
 */
function SkillBuilderRail({
  builder,
  onReveal,
  onClose,
  closeLabel,
  clearCorner = false,
}: {
  builder: SkillBuilder;
  onReveal: (key: string) => void;
  onClose: () => void;
  closeLabel: string;
  /** Leave the bottom-right corner free for the mode island. */
  clearCorner?: boolean;
}) {
  const id = useId();
  const purposeId = `${id}-purpose`;
  const { phase } = builder;
  const busy = phase.name === "generating";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-body text-warm-off-white">New skill</h2>
          <p className="text-body-sm text-bone-gray">from this conversation</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="inline-flex size-8 items-center justify-center rounded-sm text-bone-gray outline-none hover:text-warm-off-white focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-7 overflow-y-auto px-5 py-5">
        <Steps builder={builder} onReveal={onReveal} titleId={`${id}-steps`} />
        <Inputs builder={builder} titleId={`${id}-inputs`} />
        <section className="space-y-2">
          <label htmlFor={purposeId} className="text-caption-tracked uppercase text-bone-gray">
            What is it for?
          </label>
          <Textarea
            id={purposeId}
            value={builder.purpose}
            onChange={(e) => builder.setPurpose(e.target.value)}
            maxLength={PURPOSE_LIMIT}
            rows={4}
            disabled={busy}
            className="text-body-sm"
          />
          <p className="text-[12px] text-bone-gray">
            {builder.purposeEdited ? (
              <button
                type="button"
                onClick={builder.resetPurpose}
                className="text-pale-stone underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
              >
                Use my first question again
              </button>
            ) : (
              "From your first question, with the inputs swapped in."
            )}
          </p>
        </section>
      </div>

      {/*
        Status on its own line, the actions below it at full width: side by side
        in a 360px rail, the status wrapped to a word per line. For whoever sees
        the mode island, the footer keeps the band under the actions free, so the
        island and its hover label never sit on Generate.
      */}
      <div
        className={cn(
          "space-y-3 border-t border-border px-5 pt-3",
          clearCorner ? "pb-[76px]" : "pb-4",
        )}
      >
        {phase.name === "error" && (
          <p role="alert" className="text-body-sm text-traffic-red">
            {phase.message}
          </p>
        )}
        <p aria-live="polite" className="flex min-w-0 items-center gap-2 text-body-sm">
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              phase.name === "generating"
                ? "animate-pulse bg-gold-leaf"
                : builder.blockedReason
                  ? "bg-bone-gray"
                  : "bg-prompt-green",
            )}
          />
          <span className="min-w-0 truncate text-pale-stone">
            {phase.name === "generating"
              ? "Holmes is writing the skill…"
              : (builder.blockedReason ?? `${plural(builder.picked.length, "step")} ready`)}
          </span>
          {phase.name === "generating" && <Elapsed since={phase.startedAt} />}
        </p>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={busy ? builder.cancelGenerate : builder.stop}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={builder.generate}
            disabled={busy || builder.blockedReason !== null}
          >
            {phase.name === "error" ? "Retry" : "Generate draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}
