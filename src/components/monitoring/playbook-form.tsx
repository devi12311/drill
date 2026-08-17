"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PlaybookDiffPanel } from "@/components/monitoring/playbook-diff";
import type { ObservationSpec, PlaybookView } from "@/lib/monitoring/playbook";
import { diffMethod } from "@/lib/monitoring/playbook-diff";
import { OBSERVATION_SOURCE_LABEL, SELECT_CLASS } from "@/lib/monitoring/ui";
import {
  OBSERVATION_SOURCES,
  type ObservationSource,
} from "@/lib/monitoring/types";

/**
 * Edit one technology's method.
 *
 * One constraint shapes this form rather than decorates it: an observation key that
 * already has readings is **not editable** — the key is the axis its trend is
 * plotted on, so renaming it would silently split one series into two; the field is
 * disabled and says why, and removing the row is offered as the explicit
 * alternative. Otherwise it is edit and save.
 */

/**
 * Grow a textarea to its content.
 *
 * The base Textarea relies on `field-sizing: content`, which is very recent CSS — on a
 * browser without it these boxes clip a 2000-character data-source binding to three
 * lines, which makes the field unusable for exactly the entries that most need editing.
 * Done on the element rather than through state so there is no render loop.
 */
function autoSize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

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

const BLANK_SPEC: ObservationSpec = {
  key: "",
  source: "manifest",
  unit: "",
  how: "",
};

export function PlaybookForm({
  playbook,
  onSaved,
  onCancel,
}: {
  playbook: PlaybookView;
  /** Called with a note worth surfacing (an ended trend), or null if there is none. */
  onSaved: (note: string | null) => void;
  onCancel: () => void;
}) {
  const [framing, setFraming] = useState(playbook.framing);
  const [dataSources, setDataSources] = useState<string[]>([
    ...playbook.dataSources,
  ]);
  const [method, setMethod] = useState<string[]>([...playbook.method]);
  const [observations, setObservations] = useState<ObservationSpec[]>(
    playbook.observations.map((spec) => ({ ...spec })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The unsaved form against the saved method, so an edit can be reviewed before it
  // is written rather than after. Null means nothing has changed, which is also what
  // disables the save button.
  const pending = diffMethod(playbook, {
    framing,
    dataSources,
    method,
    observations,
  });
  const dirty = pending !== null;

  function setSpec(index: number, patch: Partial<ObservationSpec>) {
    setObservations((prev) =>
      prev.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)),
    );
  }

  function removeSpec(index: number) {
    const spec = observations[index];
    const readings = playbook.readings[spec.key] ?? 0;
    if (
      readings > 0 &&
      !confirm(
        `${spec.key} has ${readings} recorded reading${readings === 1 ? "" : "s"}. Removing it ends that trend — the readings already taken are kept, but no run will add to them again.`,
      )
    )
      return;
    setObservations((prev) => prev.filter((_, i) => i !== index));
  }

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
    <form onSubmit={submit} className="space-y-6">
      {/* At the TOP, not above the save button: the form is long enough that anything
          below the measurement table is effectively invisible, and "what have I changed
          so far" is a question worth answering continuously while editing. */}
      {pending && (
        <PlaybookDiffPanel diff={pending} beforeLabel="the saved method" />
      )}

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
          One paragraph of framing, in priority order. It opens the prompt, so it
          sets what the agent treats as urgent — it must never say what counts as a
          problem, which is the check catalogue&apos;s job.
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

      <fieldset className="space-y-1.5">
        <legend className="text-body-sm font-medium text-warm-off-white">
          Measurements it must return ({observations.length})
        </legend>
        <p className="max-w-[80ch] text-body-sm text-bone-gray">
          The keys are enumerated into the response schema, so an invented one is
          rejected outright — and a key that cannot be filled from a Kubernetes
          manifest is what actually forces a multi-source investigation. Keys with
          readings are locked: the key is the axis its trend is plotted on.
        </p>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-border text-caption-tracked uppercase text-bone-gray">
                <th className="px-2 py-1.5 text-left font-normal">Key</th>
                <th className="px-2 py-1.5 text-left font-normal">Source</th>
                <th className="px-2 py-1.5 text-left font-normal">Unit</th>
                <th className="px-2 py-1.5 text-left font-normal">
                  What to measure
                </th>
                <th className="w-8 px-2 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {observations.map((spec, index) => {
                const readings = playbook.readings[spec.key] ?? 0;
                return (
                  <tr key={index} className="border-t border-border/60">
                    <td className="px-2 py-1 align-top">
                      <Input
                        aria-label={`Measurement key ${index + 1}`}
                        value={spec.key}
                        onChange={(e) =>
                          setSpec(index, { key: e.target.value.toLowerCase() })
                        }
                        disabled={readings > 0}
                        placeholder="wal.generation_bytes_per_day"
                        className="h-8 min-w-[22ch] font-mono text-[12px]"
                        autoComplete="off"
                      />
                      {readings > 0 && (
                        <span className="text-caption-tracked text-bone-gray">
                          {readings} reading{readings === 1 ? "" : "s"} · locked
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 align-top">
                      <select
                        aria-label={`Source for measurement ${index + 1}`}
                        value={spec.source}
                        onChange={(e) =>
                          setSpec(index, {
                            source: e.target.value as ObservationSource,
                          })
                        }
                        className={`${SELECT_CLASS} h-8 min-w-[12ch]`}
                      >
                        {OBSERVATION_SOURCES.map((source) => (
                          <option
                            key={source}
                            value={source}
                            className="bg-popover"
                          >
                            {OBSERVATION_SOURCE_LABEL[source]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1 align-top">
                      <Input
                        aria-label={`Unit for measurement ${index + 1}`}
                        value={spec.unit}
                        onChange={(e) => setSpec(index, { unit: e.target.value })}
                        placeholder="bytes"
                        className="h-8 w-[10ch]"
                        autoComplete="off"
                      />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <Textarea
                        aria-label={`How to measure ${index + 1}`}
                        value={spec.how}
                        ref={autoSize}
                        onChange={(e) => {
                          autoSize(e.target);
                          setSpec(index, { how: e.target.value });
                        }}
                        placeholder="how to obtain it, and from where"
                        className="min-h-8 resize-none overflow-hidden text-body-sm"
                      />
                    </td>
                    <td className="px-2 py-1 align-top">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="text-traffic-red"
                        aria-label={`Remove measurement ${index + 1}`}
                        onClick={() => removeSpec(index)}
                      >
                        <X />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setObservations((prev) => [...prev, { ...BLANK_SPEC }])}
        >
          <Plus />
          Add measurement
        </Button>
      </fieldset>

      {error && (
        <p className="max-w-[80ch] text-body-sm text-traffic-red">{error}</p>
      )}

      <div className="flex items-center gap-2 border-t border-border pt-4">
        <Button type="submit" disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <p className="text-body-sm text-bone-gray">
          Takes effect on the next run. Past runs keep the prompt they were given,
          so an edit never rewrites what an older answer was measuring.
        </p>
      </div>
    </form>
  );
}
