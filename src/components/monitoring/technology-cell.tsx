"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import { WORKLOAD_TECHNOLOGY_OPTIONS } from "@/lib/monitoring/types";
import type { WorkloadKind, WorkloadTechnology } from "@/lib/monitoring/types";
import { SELECT_CLASS, TECHNOLOGY_LABEL } from "@/lib/monitoring/ui";

/**
 * One workload's technology: text until you click it.
 *
 * It used to be a native `<select>` in every row of the inventory. A real cluster
 * has hundreds of workloads — the one this was built against has 464 — and nine
 * options each meant roughly four thousand `<option>` elements in the document for
 * a control almost nobody touches. Only the row being corrected needs a control.
 *
 * The new value is not computed here. The server derives the effective technology
 * from the override plus the detected value, so the page is re-rendered from it
 * rather than patched locally — duplicating that rule in the client is how the two
 * drift apart. What changed is that the page no longer blanks itself and
 * re-downloads the whole inventory to change one string.
 */
export function TechnologyCell({
  clusterId,
  workload,
}: {
  clusterId: string;
  workload: {
    kind: WorkloadKind;
    namespace: string;
    name: string;
    technology: WorkloadTechnology | null;
    technologyReason: string | null;
    technologyOverride: WorkloadTechnology | null;
  };
}) {
  const refresh = useRefreshThenNavigate();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(technology: string) {
    setEditing(false);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/monitoring/clusters/${clusterId}/workloads`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: workload.kind,
            namespace: workload.namespace,
            name: workload.name,
            technology: technology || null,
          }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      refresh(null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not set the technology",
      );
    } finally {
      setSaving(false);
    }
  }

  if (editing)
    return (
      <select
        autoFocus
        defaultValue={workload.technology ?? ""}
        onChange={(e) => save(e.target.value)}
        onBlur={() => setEditing(false)}
        className={cn(SELECT_CLASS, "h-7 w-auto")}
        aria-label={`Technology for ${workload.name}`}
      >
        <option value="" className="bg-popover">
          — none —
        </option>
        {WORKLOAD_TECHNOLOGY_OPTIONS.map((option) => (
          <option key={option} value={option} className="bg-popover">
            {TECHNOLOGY_LABEL[option]}
          </option>
        ))}
      </select>
    );

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      disabled={saving}
      className="group/tech flex items-start gap-1.5 text-left"
    >
      <span className="space-y-0.5">
        <span className="block text-pale-stone group-hover/tech:text-warm-off-white">
          {workload.technology
            ? TECHNOLOGY_LABEL[workload.technology]
            : "— none —"}
        </span>
        {/* Why we think so, or that a human said so — a guess you cannot
            interrogate is a guess you cannot correct with confidence. */}
        <span
          className={cn(
            "block text-caption-tracked",
            error ? "text-traffic-red" : "text-bone-gray",
          )}
        >
          {error ??
            (saving
              ? "saving…"
              : workload.technologyOverride
                ? "set by hand"
                : (workload.technologyReason ?? "not recognised"))}
        </span>
      </span>
      <Pencil className="mt-0.5 size-3 shrink-0 text-transparent group-hover/tech:text-bone-gray" />
    </button>
  );
}
