"use client";

import { Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SKILL_LIMITS, toInputKey, type SkillInput } from "@/lib/skills/types";

/** The control a row's problem is shown against, so "N problems ↑" can focus it. */
export const inputRowId = (i: number) => `skill-input-${i}-label`;

/** `service_name` → "Service name": a label for an input that only had a key. */
export function labelForKey(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The inputs a run asks for. You name an input once, by its label; the key the
 * procedure uses (`{{service_name}}`) follows the label until you change the
 * key yourself — detected statelessly: a key still equal to what the previous
 * label made of itself was never hand-edited.
 */
export function SkillInputRows({
  inputs,
  onChange,
  errors,
}: {
  inputs: SkillInput[];
  onChange: (inputs: SkillInput[]) => void;
  /** Row index → that row's problem, already filtered to what is worth showing. */
  errors: Record<number, string>;
}) {
  const set = (i: number, patch: Partial<SkillInput>) =>
    onChange(inputs.map((input, idx) => (idx === i ? { ...input, ...patch } : input)));
  const setLabel = (i: number, label: string) => {
    const input = inputs[i];
    const follows = input.key === "" || input.key === toInputKey(input.label);
    set(i, follows ? { label, key: toInputKey(label) } : { label });
  };

  return (
    <div className="space-y-3">
      {inputs.map((input, i) => (
        <div key={i} className="space-y-1">
          {/* Wraps by the space it has (the sidebar, not the window, decides): the
              key drops below the label rather than squeezing it. */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={inputRowId(i)}
              value={input.label}
              onChange={(e) => setLabel(i, e.target.value)}
              placeholder="Service name"
              aria-label={`Input ${i + 1} label`}
              aria-invalid={errors[i] ? true : undefined}
              aria-describedby={errors[i] ? `skill-input-${i}-error` : undefined}
              maxLength={SKILL_LIMITS.label}
              className="min-w-48 flex-1"
            />
            <div className="flex w-full items-center gap-1 sm:w-52">
              <span aria-hidden className="font-mono text-[12px] text-bone-gray">{"{{"}</span>
              <Input
                value={input.key}
                onChange={(e) => set(i, { key: toInputKey(e.target.value) })}
                placeholder="service_name"
                aria-label={`Input ${i + 1} key, used in the procedure as {{key}}`}
                className="h-8 min-w-0 flex-1 font-mono text-[12px] text-pale-stone"
              />
              <span aria-hidden className="font-mono text-[12px] text-bone-gray">{"}}"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <label className="flex h-11 shrink-0 items-center gap-2 text-body-sm text-pale-stone sm:h-auto">
                <Checkbox
                  checked={input.required}
                  onCheckedChange={(v) => set(i, { required: v === true })}
                />
                required
              </label>
              <button
                type="button"
                aria-label={`Remove input ${input.label || input.key || i + 1}`}
                onClick={() => onChange(inputs.filter((_, idx) => idx !== i))}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-bone-gray outline-none hover:text-traffic-red focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-8"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          {errors[i] && (
            <p id={`skill-input-${i}-error`} className="text-body-sm text-traffic-red">
              {errors[i]}
            </p>
          )}
        </div>
      ))}
      {inputs.length < SKILL_LIMITS.inputs && (
        <button
          type="button"
          onClick={() => onChange([...inputs, { key: "", label: "", required: false }])}
          className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-body-sm text-bone-gray outline-none hover:text-warm-off-white focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-3.5" />
          add input
        </button>
      )}
    </div>
  );
}
