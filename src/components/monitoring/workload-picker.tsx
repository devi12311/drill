"use client";

import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TECHNOLOGY_LABEL } from "@/lib/monitoring/ui";
import type {
  AssessmentTarget,
  WorkloadKind,
  WorkloadTechnology,
} from "@/lib/monitoring/types";

export interface PickableWorkload {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  replicas: number | null;
  /** What discovery detected, or the admin's override where one is set. */
  technology: WorkloadTechnology | null;
  /** Whether a deep assessment has a playbook for that technology. */
  profiled: boolean;
}

export function targetKey(target: {
  kind: string;
  namespace: string;
  name: string;
}) {
  return `${target.kind}/${target.namespace}/${target.name}`;
}

/**
 * Multi-select over a cluster's discovered workloads, grouped by namespace with
 * a filter — a real cluster has hundreds, so a flat checkbox list is unusable.
 */
export function WorkloadPicker({
  workloads,
  selected,
  onChange,
}: {
  workloads: PickableWorkload[];
  selected: AssessmentTarget[];
  onChange: (next: AssessmentTarget[]) => void;
}) {
  const [filter, setFilter] = useState("");
  const selectedKeys = useMemo(
    () => new Set(selected.map(targetKey)),
    [selected],
  );

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const matching = needle
      ? workloads.filter(
          (w) =>
            w.name.toLowerCase().includes(needle) ||
            w.namespace.toLowerCase().includes(needle),
        )
      : workloads;
    const byNamespace = new Map<string, PickableWorkload[]>();
    for (const workload of matching) {
      const list = byNamespace.get(workload.namespace) ?? [];
      list.push(workload);
      byNamespace.set(workload.namespace, list);
    }
    return [...byNamespace.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [workloads, filter]);

  function toggle(workload: PickableWorkload) {
    const key = targetKey(workload);
    const target: AssessmentTarget = {
      kind: workload.kind,
      namespace: workload.namespace,
      name: workload.name,
    };
    onChange(
      selectedKeys.has(key)
        ? selected.filter((t) => targetKey(t) !== key)
        : [...selected, target],
    );
  }

  function toggleNamespace(items: PickableWorkload[]) {
    const keys = items.map(targetKey);
    const allSelected = keys.every((k) => selectedKeys.has(k));
    onChange(
      allSelected
        ? selected.filter((t) => !keys.includes(targetKey(t)))
        : [
            ...selected.filter((t) => !keys.includes(targetKey(t))),
            ...items.map((w) => ({
              kind: w.kind,
              namespace: w.namespace,
              name: w.name,
            })),
          ],
    );
  }

  return (
    <div className="space-y-3">
      <Input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name or namespace…"
        autoComplete="off"
      />

      <div className="max-h-[360px] overflow-y-auto rounded-lg border border-border">
        {groups.length === 0 ? (
          <p className="px-4 py-6 text-body-sm text-bone-gray">
            No workloads match.
          </p>
        ) : (
          groups.map(([namespace, items]) => {
            const allSelected = items.every((w) =>
              selectedKeys.has(targetKey(w)),
            );
            return (
              <div key={namespace} className="border-b border-border/60 last:border-0">
                <button
                  type="button"
                  onClick={() => toggleNamespace(items)}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-caption-tracked uppercase text-bone-gray transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white"
                >
                  <span>{namespace}</span>
                  <span>{allSelected ? "clear all" : "select all"}</span>
                </button>
                {items.map((workload) => {
                  const key = targetKey(workload);
                  const checked = selectedKeys.has(key);
                  return (
                    <label
                      key={key}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-4 py-1.5 text-body-sm transition-colors hover:bg-smoke-charcoal",
                        checked ? "text-warm-off-white" : "text-pale-stone",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggle(workload)}
                      />
                      <span className="font-mono text-[12px] text-bone-gray">
                        {workload.kind === "statefulset" ? "sts" : "deploy"}
                      </span>
                      <span className="truncate">{workload.name}</span>
                      {workload.technology && (
                        // Dimmed when no playbook exists yet: the technology is
                        // known but a deep run would still only ask the generic
                        // questions, and pretending otherwise would mislead.
                        <span
                          className={cn(
                            "shrink-0 rounded-sm border px-1.5 text-caption-tracked",
                            workload.profiled
                              ? "border-border text-pale-stone"
                              : "border-border/60 text-bone-gray",
                          )}
                        >
                          {TECHNOLOGY_LABEL[workload.technology]}
                        </span>
                      )}
                      {workload.replicas !== null && (
                        <span className="ml-auto shrink-0 text-caption-tracked text-bone-gray">
                          {workload.replicas} replica
                          {workload.replicas === 1 ? "" : "s"}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
