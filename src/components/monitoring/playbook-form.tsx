"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogBody } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
}: {
  id: string;
  label: string;
  hint: string;
  placeholder: string;
  lines: string[];
  onChange: (next: string[]) => void;
}) {
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
      <legend className="text-body-sm font-medium text-warm-off-white">
        {label}
      </legend>
      <p className="max-w-[80ch] text-body-sm text-bone-gray">{hint}</p>
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
              ref={autoSize}
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

  // The unsaved form against the saved method, so an edit can be reviewed before
  // it is written rather than after. Null means nothing has changed, which is
  // also what disables the save button. Memoised because it word-diffs the whole
  // method and now runs on every keystroke to keep the footer honest.
  const pending = useMemo(
    () => diffMethod(playbook, { framing, dataSources, method, observations }),
    [playbook, framing, dataSources, method, observations],
  );
  const dirty = pending !== null;

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  // Derived rather than reset: with nothing pending there is nothing to review,
  // and saving from the review panel returns to the fields on its own.
  const showDiff = reviewing && pending !== null;

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
        {showDiff && pending ? (
          <PlaybookDiffPanel diff={pending} beforeLabel="the saved method" />
        ) : (
          <>
            <div className="space-y-1.5">
              <Label htmlFor={`framing-${playbook.technology}`}>
                What this technology dies of
              </Label>
              <Textarea
                id={`framing-${playbook.technology}`}
                value={framing}
                ref={autoSize}
                onChange={(e) => {
                  autoSize(e.target);
                  setFraming(e.target.value);
                }}
                className="min-h-28 resize-none overflow-hidden text-body-sm"
                required
              />
              <p className="max-w-[80ch] text-body-sm text-bone-gray">
                One paragraph of framing, in priority order. It opens the prompt,
                so it sets what the agent treats as urgent — it must never say
                what counts as a problem, which is the check catalogue&apos;s job.
              </p>
            </div>

            <LineList
              id={`sources-${playbook.technology}`}
              label="Where the data is"
              hint="One binding per line: which toolset, which labels, which credentials. Use {{namespace}} and {{name}} for the workload being assessed — no other placeholder is substituted. This is the half a method is useless without: an agent that has to guess which database a StatefulSet is will spend its tool calls guessing."
              placeholder="Metrics: PromQL against Prometheus. The exporter for {{name}} in {{namespace}} is labelled …"
              lines={dataSources}
              onChange={setDataSources}
            />

            <LineList
              id={`method-${playbook.technology}`}
              label="How to investigate, in order"
              hint="One step per line, most-fatal-first. Order is part of the method: it is rendered numbered, and an agent that runs out of budget should have done the important half."
              placeholder="Check for transaction-ID wraparound first: it is the only failure here that stops writes cluster-wide …"
              lines={method}
              onChange={setMethod}
            />

            <MeasurementRows
              observations={observations}
              readings={playbook.readings}
              onChange={setObservations}
            />
          </>
        )}

        {error && (
          <p className="max-w-[80ch] text-body-sm text-traffic-red">{error}</p>
        )}
      </DialogBody>

      <ModalFooter>
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
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
