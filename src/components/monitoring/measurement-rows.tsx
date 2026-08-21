"use client";

import { useState } from "react";
import { ChevronRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { autoSize } from "@/components/monitoring/auto-size";
import type { ObservationSpec } from "@/lib/monitoring/playbook";
import { PLAYBOOK_LIMITS } from "@/lib/monitoring/playbook-input";
import { OBSERVATION_SOURCE_LABEL, SELECT_CLASS } from "@/lib/monitoring/ui";
import {
  OBSERVATION_SOURCES,
  type ObservationSource,
} from "@/lib/monitoring/types";
import { cn } from "@/lib/utils";

/**
 * The measurements a method must return, as a list you read and open one row of.
 *
 * This was a five-column table, and it was the worst-proportioned thing in the
 * app: the widest field in the form — a paragraph saying how to obtain the value
 * and from where — competed with three narrow ones inside a column that could not
 * hold them, so the table fell back to horizontal scrolling and the paragraph got
 * about thirty characters. A row per measurement fixes the proportion rather than
 * the symptom. Editing eighteen at once is not a thing anyone does; editing one is.
 *
 * One row is open at a time, deliberately — the closed rows stay a readable index
 * of what this method measures while you work on a single spec.
 */

const BLANK_SPEC: ObservationSpec = {
  key: "",
  source: "manifest",
  unit: "",
  how: "",
};

export function MeasurementRows({
  observations,
  readings,
  onChange,
  error,
}: {
  observations: ObservationSpec[];
  /** Reading counts per key. A key with readings is locked — see below. */
  readings: Record<string, number>;
  onChange: (next: ObservationSpec[]) => void;
  /** The first thing wrong with the set, named where the set is edited. */
  error?: string;
}) {
  /**
   * Which row is open, tracked by KEY rather than by position.
   *
   * With an index, removing row 3 left the row that used to be row 4 open —
   * `openIndex` still pointed at 3, which is now something else. A new row has no
   * key yet, so it opens as the empty string, which is also what makes it the only
   * blank row that can exist at a time.
   */
  const [openKey, setOpenKey] = useState<string | null>(null);

  function setSpec(index: number, patch: Partial<ObservationSpec>) {
    // A rename of the open row has to carry the open state with it.
    if (patch.key !== undefined && observations[index]?.key === openKey)
      setOpenKey(patch.key);
    onChange(
      observations.map((spec, i) => (i === index ? { ...spec, ...patch } : spec)),
    );
  }

  function removeSpec(index: number) {
    const spec = observations[index];
    const count = readings[spec.key] ?? 0;
    if (
      count > 0 &&
      !confirm(
        `${spec.key} has ${count} recorded reading${count === 1 ? "" : "s"}. Removing it ends that trend — the readings already taken are kept, but no run will add to them again.`,
      )
    )
      return;
    onChange(observations.filter((_, i) => i !== index));
    setOpenKey(null);
  }

  return (
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
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}

      <div className="divide-y divide-border rounded-lg border border-border">
        {observations.map((spec, index) => {
          const count = readings[spec.key] ?? 0;
          const open = openKey === spec.key;
          return (
            // Keyed on the measurement, not its position: these rows are
            // reorderable and removable, and an index key hands one row's DOM (and
            // the height `autoSize` set on it) to a different measurement.
            <div key={spec.key || `new-${index}`}>
              <div className="flex items-start gap-1">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenKey(open ? null : spec.key)}
                  className="flex min-w-0 flex-1 items-start gap-2 px-2 py-2 text-left transition-colors hover:bg-accent/40"
                >
                  <ChevronRight
                    className={cn(
                      "mt-0.5 size-3.5 shrink-0 text-bone-gray transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[12px] text-pale-stone">
                      {spec.key || "new measurement"}
                    </span>
                    <span className="block truncate text-caption-tracked uppercase text-bone-gray">
                      {OBSERVATION_SOURCE_LABEL[spec.source] ?? spec.source}
                      {spec.unit && (
                        <span className="normal-case"> · {spec.unit}</span>
                      )}
                      {count > 0 && (
                        <span className="normal-case">
                          {" "}
                          · {count} reading{count === 1 ? "" : "s"} · locked
                        </span>
                      )}
                    </span>
                    {!open && spec.how && (
                      <span className="mt-0.5 block truncate text-body-sm text-bone-gray">
                        {spec.how}
                      </span>
                    )}
                  </span>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="mt-2 mr-1 text-traffic-red"
                  aria-label={`Remove measurement ${spec.key || index + 1}`}
                  onClick={() => removeSpec(index)}
                >
                  <X />
                </Button>
              </div>

              {open && (
                <div className="space-y-3 border-t border-border/60 px-3 py-3">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                    <Field
                      id={`spec-key-${index}`}
                      label="Key"
                      description={
                        count > 0
                          ? "Locked — renaming it would split one trend into two. Remove the measurement instead if it should stop being taken."
                          : "Lowercase, dotted: a group and a name, e.g. wal.generation_bytes_per_day. Two engines that measure the same thing should deliberately share a key, because the key IS the trend axis."
                      }
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={spec.key}
                          onChange={(e) =>
                            setSpec(index, { key: e.target.value.toLowerCase() })
                          }
                          disabled={count > 0}
                          placeholder="wal.generation_bytes_per_day"
                          className="font-mono text-[12px]"
                          autoComplete="off"
                        />
                      )}
                    </Field>
                    <Field
                      id={`spec-source-${index}`}
                      label="Source"
                      description="Where the number comes from. Anything but a manifest is what forces a real investigation rather than a config read."
                    >
                      {(props) => (
                        <select
                          {...props}
                          value={spec.source}
                          onChange={(e) =>
                            setSpec(index, {
                              source: e.target.value as ObservationSource,
                            })
                          }
                          className={SELECT_CLASS}
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
                      )}
                    </Field>
                    <Field
                      id={`spec-unit-${index}`}
                      label="Unit"
                      optional
                      value={spec.unit}
                      limit={PLAYBOOK_LIMITS.unit}
                      description="Shown beside the reading, and what makes two runs comparable."
                    >
                      {(props) => (
                        <Input
                          {...props}
                          value={spec.unit}
                          onChange={(e) =>
                            setSpec(index, { unit: e.target.value })
                          }
                          placeholder="bytes"
                          autoComplete="off"
                        />
                      )}
                    </Field>
                  </div>

                  <Field
                    id={`spec-how-${index}`}
                    label="What to measure"
                    value={spec.how}
                    limit={PLAYBOOK_LIMITS.how}
                    description="The instruction, not the name: which counter, which query, against what. This is what the agent is actually told, so a vague one comes back as a missing reading."
                  >
                    {(props) => (
                    <Textarea
                      {...props}
                      value={spec.how}
                      ref={autoSize}
                      onChange={(e) => {
                        autoSize(e.target);
                        setSpec(index, { how: e.target.value });
                      }}
                      placeholder="how to obtain it, and from where"
                      className="min-h-20 resize-none overflow-hidden text-body-sm"
                    />
                    )}
                  </Field>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          onChange([...observations, { ...BLANK_SPEC }]);
          // The new row's key is "" until it is named, which is how it opens.
          setOpenKey("");
        }}
      >
        <Plus />
        Add measurement
      </Button>
    </fieldset>
  );
}
