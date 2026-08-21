"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogBody } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { autoSize } from "@/components/monitoring/auto-size";
import { ModalFooter } from "@/components/monitoring/definition-modal";
import { MeasurementRows } from "@/components/monitoring/measurement-rows";
import {
  DiffHeadline,
  PlaybookDiffPanel,
} from "@/components/monitoring/playbook-diff";
import type { ObservationSpec, PlaybookView } from "@/lib/monitoring/playbook";
import { diffMethod } from "@/lib/monitoring/playbook-diff";
import {
  KEY_PATTERN,
  PLACEHOLDERS,
  PLAYBOOK_LIMITS,
} from "@/lib/monitoring/playbook-input";

/**
 * Edit one technology's method.
 *
 * Two constraints shape this form rather than decorate it.
 *
 * An observation key that already has readings is **not editable** — the key is
 * the axis its trend is plotted on, so renaming it would silently split one
 * series into two; the field is disabled and says why, and removing the row is
 * offered as the explicit alternative.
 *
 * And the comparison against the saved method is a footer, not a banner. It used
 * to sit at the top, which answered "what have I changed so far" continuously and
 * charged the top of the form for it — worse, it grew as you typed, so the field
 * you were editing walked down the page while you edited it. The signal stays
 * permanent; only its rendering waits to be asked for.
 */

/** Reorderable list of prose lines — used for both data sources and method steps. */
function LineList({
  id,
  label,
  hint,
  placeholder,
  lines,
  onChange,
  error,
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  lines: string[];
  onChange: (next: string[]) => void;
  /** Shown under the list, so a rejected entry is named where it lives. */
  error?: string;
}) {
  /**
   * The rendered textareas, so their heights can follow their CONTENT.
   *
   * `autoSize` writes an explicit pixel height on the element, and these rows are
   * keyed by position (the lines are a plain `string[]`, with no identity of their
   * own). So moving a line up swaps the values under stable DOM nodes and the
   * heights stay behind with the positions — a one-line step wearing a paragraph's
   * height, and vice versa. Re-sizing on every change to the list fixes it without
   * inventing identities the API does not have.
   */
  const nodes = useRef(new Map<number, HTMLTextAreaElement>());
  useEffect(() => {
    for (const node of nodes.current.values()) autoSize(node);
  }, [lines]);

  function set(index: number, value: string) {
    onChange(lines.map((line, i) => (i === index ? value : line)));
  }

  function move(index: number, delta: number) {
    const next = [...lines];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className="flex items-baseline justify-between gap-3">
        <span className="text-body-sm font-medium text-warm-off-white">
          {label}
        </span>
        <span className="text-caption-tracked text-bone-gray">
          {lines.length} of {PLAYBOOK_LIMITS.entries}
        </span>
      </legend>
      <p className="max-w-[80ch] text-body-sm text-bone-gray">{hint}</p>
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      <div className="space-y-1.5">
        {lines.map((line, index) => (
          <div key={index} className="flex items-start gap-1.5">
            <span className="w-6 pt-2 text-right font-mono text-[12px] text-bone-gray">
              {index + 1}
            </span>
            <Textarea
              id={`${id}-${index}`}
              aria-label={`${label} ${index + 1}`}
              value={line}
              ref={(node) => {
                if (node) nodes.current.set(index, node);
                else nodes.current.delete(index);
                autoSize(node);
              }}
              onChange={(e) => {
                autoSize(e.target);
                set(index, e.target.value);
              }}
              placeholder={placeholder}
              className="min-h-16 flex-1 resize-none overflow-hidden text-body-sm"
            />
            <div className="flex flex-col gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${label} ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Move ${label} ${index + 1} down`}
                disabled={index === lines.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-traffic-red"
                aria-label={`Remove ${label} ${index + 1}`}
                onClick={() => onChange(lines.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...lines, ""])}
      >
        <Plus />
        Add
      </Button>
    </fieldset>
  );
}

export function PlaybookForm({
  playbook,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  playbook: PlaybookView;
  /** Called with a note worth surfacing (an ended trend), or null if there is none. */
  onSaved: (note: string | null) => void;
  onCancel: () => void;
  /** Lifted so the panel's Escape/overlay close can guard unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [framing, setFraming] = useState(playbook.framing);
  const [dataSources, setDataSources] = useState<string[]>([
    ...playbook.dataSources,
  ]);
  const [method, setMethod] = useState<string[]>([...playbook.method]);
  const [observations, setObservations] = useState<ObservationSpec[]>(
    playbook.observations.map((spec) => ({ ...spec })),
  );
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The unsaved form against the saved method, so an edit can be reviewed before
   * it is written rather than after. Null means nothing has changed, which is also
   * what disables the save button.
   *
   * TWO diffs, deliberately. This one runs on every keystroke — it has to, because
   * the save button and the footer line depend on it — so it is asked for counts
   * only. Word-level segments are built once, when the review panel is actually
   * opened. Diffing in detail per keystroke meant a word-LCS matrix over the
   * framing paragraph plus one per changed line, on every character typed, for
   * output nobody was looking at.
   */
  const pending = useMemo(
    () => diffMethod(playbook, { framing, dataSources, method, observations }),
    [playbook, framing, dataSources, method, observations],
  );
  const dirty = pending !== null;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  // Derived rather than reset: with nothing pending there is nothing to review,
  // and saving from the review panel returns to the fields on its own.
  const showDiff = reviewing && pending !== null;
  /**
   * Validated against the very constants the route validates against
   * (`PLAYBOOK_LIMITS`, `KEY_PATTERN`, `PLACEHOLDERS`, all exported for this) so
   * the two cannot drift. The rules were all real and all invisible: the dotted
   * key pattern was never stated anywhere in the form, and every cap and every
   * "at least one" surfaced as a 400 after a round trip.
   */
  const problems = useMemo(() => {
    const found: Record<string, string> = {};
    const unknownPlaceholder = (value: string) => {
      for (const [, inner] of value.matchAll(/\{\{([^}]*)\}\}/g))
        if (!PLACEHOLDERS.includes(inner.trim())) return inner.trim();
      return null;
    };

    if (!framing.trim()) found.framing = "The framing paragraph is required.";
    else if (framing.length > PLAYBOOK_LIMITS.framing)
      found.framing = `${framing.length} characters; the limit is ${PLAYBOOK_LIMITS.framing}.`;
    else {
      const bad = unknownPlaceholder(framing);
      if (bad)
        found.framing = `{{${bad}}} is not substituted — only {{namespace}} and {{name}} are. Anything else reaches the model as literal text.`;
    }

    for (const [field, lines, label] of [
      ["dataSources", dataSources, "data source"],
      ["method", method, "step"],
    ] as const) {
      const filled = lines.filter((line) => line.trim());
      if (filled.length === 0) found[field] = `At least one ${label} is required.`;
      else if (lines.length > PLAYBOOK_LIMITS.entries)
        found[field] = `${lines.length} entries; the limit is ${PLAYBOOK_LIMITS.entries}.`;
      else {
        const over = lines.find((l) => l.length > PLAYBOOK_LIMITS.entry);
        if (over)
          found[field] = `One entry is ${over.length} characters; the limit is ${PLAYBOOK_LIMITS.entry}.`;
        else
          for (const line of lines) {
            const bad = unknownPlaceholder(line);
            if (bad) {
              found[field] = `{{${bad}}} is not substituted — only {{namespace}} and {{name}} are.`;
              break;
            }
          }
      }
    }

    if (observations.length === 0)
      found.observations = "A method has to bring at least one measurement back.";
    else if (observations.length > PLAYBOOK_LIMITS.observations)
      found.observations = `${observations.length} measurements; the limit is ${PLAYBOOK_LIMITS.observations}.`;
    else {
      const seen = new Set<string>();
      for (const spec of observations) {
        if (!KEY_PATTERN.test(spec.key)) {
          found.observations = `"${spec.key || "(unnamed)"}" is not a valid key. Lowercase, dotted — e.g. wal.generation_bytes_per_day.`;
          break;
        }
        if (seen.has(spec.key)) {
          found.observations = `${spec.key} appears twice; a key is one measurement.`;
          break;
        }
        seen.add(spec.key);
        if (!spec.how.trim()) {
          found.observations = `${spec.key} does not say what to measure.`;
          break;
        }
        if (spec.how.length > PLAYBOOK_LIMITS.how) {
          found.observations = `${spec.key}'s instruction is ${spec.how.length} characters; the limit is ${PLAYBOOK_LIMITS.how}.`;
          break;
        }
        if (spec.unit.length > PLAYBOOK_LIMITS.unit) {
          found.observations = `${spec.key}'s unit is longer than ${PLAYBOOK_LIMITS.unit} characters.`;
          break;
        }
      }
    }
    return found;
  }, [framing, dataSources, method, observations]);
  const invalid = Object.keys(problems).length > 0;

  const detailed = useMemo(
    () =>
      showDiff
        ? diffMethod(
            playbook,
            { framing, dataSources, method, observations },
            { detail: true },
          )
        : null,
    [showDiff, playbook, framing, dataSources, method, observations],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    // Locked keys are un-renameable in the form, so anything locked and missing
    // here was removed deliberately — which is exactly what the API asks us to
    // state rather than let it happen as a side effect of a rename.
    const kept = new Set(observations.map((spec) => spec.key));
    const dropKeys = Object.keys(playbook.readings).filter(
      (key) => !kept.has(key),
    );
    try {
      const res = await fetch(
        `/api/admin/monitoring/profiles/${playbook.technology}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            framing,
            dataSources,
            method,
            observations,
            dropKeys,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const dropped = (body.droppedKeys ?? []) as { key: string }[];
      onSaved(
        dropped.length > 0
          ? `Saved. ${dropped.map((d) => d.key).join(", ")} will no longer be measured; the readings already taken are kept.`
          : null,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the playbook",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogBody className="space-y-6">
        {showDiff && detailed ? (
          <PlaybookDiffPanel diff={detailed} beforeLabel="the saved method" />
        ) : (
          <>
            <Field
              id={`framing-${playbook.technology}`}
              label="What this technology dies of"
              error={problems.framing}
              value={framing}
              limit={PLAYBOOK_LIMITS.framing}
              description={
                <>
                  One paragraph of framing, in priority order. It opens the
                  prompt, so it sets what the agent treats as urgent — it must
                  never say what counts as a problem, which is the check
                  catalogue&apos;s job.
                </>
              }
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={framing}
                  ref={autoSize}
                  onChange={(e) => {
                    autoSize(e.target);
                    setFraming(e.target.value);
                  }}
                  className="min-h-28 resize-none overflow-hidden text-body-sm"
                />
              )}
            </Field>

            <LineList
              id={`sources-${playbook.technology}`}
              label="Where the data is"
              hint="One binding per line: which toolset, which labels, which credentials. Use {{namespace}} and {{name}} for the workload being assessed — no other placeholder is substituted. This is the half a method is useless without: an agent that has to guess which database a StatefulSet is will spend its tool calls guessing."
              placeholder="Metrics: PromQL against Prometheus. The exporter for {{name}} in {{namespace}} is labelled …"
              lines={dataSources}
              onChange={setDataSources}
              error={problems.dataSources}
            />

            <LineList
              id={`method-${playbook.technology}`}
              label="How to investigate, in order"
              hint="One step per line, most-fatal-first. Order is part of the method: it is rendered numbered, and an agent that runs out of budget should have done the important half."
              placeholder="Check for transaction-ID wraparound first: it is the only failure here that stops writes cluster-wide …"
              lines={method}
              onChange={setMethod}
              error={problems.method}
            />

            <MeasurementRows
              observations={observations}
              readings={playbook.readings}
              onChange={setObservations}
              error={problems.observations}
            />
          </>
        )}

        {error && (
          <p className="max-w-[80ch] text-body-sm text-traffic-red">{error}</p>
        )}
      </DialogBody>

      <ModalFooter>
        <Button type="submit" disabled={busy || !dirty || invalid}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {invalid && (
          <span className="text-body-sm text-traffic-red">
            Not saveable yet — see the fields above.
          </span>
        )}
        {pending ? (
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReviewing((v) => !v)}
            >
              {showDiff ? "Back to editing" : "Review changes"}
            </Button>
            <DiffHeadline diff={pending} className="min-w-0 flex-1 truncate" />
          </>
        ) : (
          <p className="min-w-0 flex-1 text-body-sm text-bone-gray">
            Takes effect on the next run. Past runs keep the prompt they were
            given, so an edit never rewrites what an older answer was measuring.
          </p>
        )}
      </ModalFooter>
    </form>
  );
}
