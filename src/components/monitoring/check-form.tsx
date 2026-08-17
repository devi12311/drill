"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { REQUIREMENT_LABEL } from "@/lib/monitoring/catalogue";
import {
  CATEGORY_LABEL,
  SELECT_CLASS,
  TECHNOLOGY_LABEL,
} from "@/lib/monitoring/ui";
import {
  MONITOR_CATEGORIES,
  SEVERITIES,
  WORKLOAD_KINDS,
  WORKLOAD_TECHNOLOGIES,
  type MonitorCategory,
  type Severity,
  type WorkloadKind,
  type WorkloadTechnology,
  type CheckView,
} from "@/lib/monitoring/types";

/**
 * Author or retune a check. Editing an existing one cannot change its ID —
 * concerns reference it by value, so a rename would orphan their history; the
 * form says so rather than silently disabling the field.
 */
export function CheckForm({
  check,
  onSaved,
}: {
  check?: CheckView;
  onSaved: () => void;
}) {
  const editing = Boolean(check);
  const [id, setId] = useState(check?.id ?? "");
  const [category, setCategory] = useState<MonitorCategory>(
    check?.category ?? "security",
  );
  const [title, setTitle] = useState(check?.title ?? "");
  const [question, setQuestion] = useState(check?.question ?? "");
  const [evidence, setEvidence] = useState(check?.evidence ?? "");
  const [reference, setReference] = useState(check?.reference ?? "");
  const [baseSeverity, setBaseSeverity] = useState<Severity>(
    check?.baseSeverity ?? "medium",
  );
  const [appliesTo, setAppliesTo] = useState<WorkloadKind[]>(
    (check?.appliesTo as WorkloadKind[]) ?? [],
  );
  const [appliesToTechnologies, setAppliesToTechnologies] = useState<
    WorkloadTechnology[]
  >((check?.appliesToTechnologies as WorkloadTechnology[]) ?? []);
  const [excludesTechnologies, setExcludesTechnologies] = useState<
    WorkloadTechnology[]
  >((check?.excludesTechnologies as WorkloadTechnology[]) ?? []);
  const [requires, setRequires] = useState(check?.requires ?? "");
  const [absentRuns, setAbsentRuns] = useState(
    String(check?.resolveAfterAbsentRuns ?? 1),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleKind(kind: WorkloadKind) {
    setAppliesTo((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  function toggleTechnology(
    technology: WorkloadTechnology,
    setter: typeof setAppliesToTechnologies,
  ) {
    setter((prev) =>
      prev.includes(technology)
        ? prev.filter((t) => t !== technology)
        : [...prev, technology],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      category,
      title,
      question,
      evidence,
      reference,
      baseSeverity,
      appliesTo,
      appliesToTechnologies,
      excludesTechnologies,
      requires: requires || null,
      resolveAfterAbsentRuns: Number(absentRuns),
    };
    try {
      const res = await fetch(
        editing
          ? `/api/admin/monitoring/checks/${check!.id}`
          : "/api/admin/monitoring/checks",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing ? payload : { id, ...payload }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the check");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="check-id">Check ID</Label>
          <Input
            id="check-id"
            value={id}
            onChange={(e) => setId(e.target.value.toUpperCase())}
            placeholder="CUSTOM.INGRESS_TLS"
            className="font-mono text-[12px]"
            autoComplete="off"
            disabled={editing}
            required
          />
          <p className="text-body-sm text-bone-gray">
            {editing
              ? "Permanent — concerns reference it by value, so it can never be renamed."
              : "PREFIX.NAME, uppercase. Chosen once and permanent."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="check-category">Category</Label>
          <select
            id="check-category"
            value={category}
            onChange={(e) => setCategory(e.target.value as MonitorCategory)}
            className={SELECT_CLASS}
          >
            {MONITOR_CATEGORIES.map((option) => (
              <option key={option} value={option} className="bg-popover">
                {CATEGORY_LABEL[option]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-title">Title</Label>
        <Input
          id="check-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ingress does not enforce TLS"
          autoComplete="off"
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-question">What must Holmes determine?</Label>
        <Textarea
          id="check-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Does any Ingress routing to this workload lack a tls block, serving plaintext to clients?"
          className="h-20"
          required
        />
        <p className="text-body-sm text-bone-gray">
          Phrase it so a failure is unambiguous. This goes into the prompt
          verbatim, once per workload.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-evidence">Evidence it must cite</Label>
        <Textarea
          id="check-evidence"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
          placeholder="The Ingress name, its host rules, and the tls block as configured."
          className="h-16"
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="check-severity">Base severity</Label>
          <select
            id="check-severity"
            value={baseSeverity}
            onChange={(e) => setBaseSeverity(e.target.value as Severity)}
            className={SELECT_CLASS}
          >
            {SEVERITIES.map((option) => (
              <option key={option} value={option} className="bg-popover">
                {option}
              </option>
            ))}
          </select>
          <p className="text-body-sm text-bone-gray">
            Holmes may adjust this per cluster, but the deviation is recorded
            rather than replacing it.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="check-reference">Cites (optional)</Label>
          <Input
            id="check-reference"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="kubescape C-0263 · internal policy SEC-14"
            autoComplete="off"
          />
          <p className="text-body-sm text-bone-gray">
            The standard or policy this comes from — what makes the severity
            defensible.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="check-requires">Needs extra telemetry?</Label>
          <select
            id="check-requires"
            value={requires}
            onChange={(e) => setRequires(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="" className="bg-popover">
              No — answerable from the cluster itself
            </option>
            {Object.entries(REQUIREMENT_LABEL).map(([value, label]) => (
              <option key={value} value={value} className="bg-popover">
                {label}
              </option>
            ))}
          </select>
          <p className="text-body-sm text-bone-gray">
            When it is unavailable Holmes must skip the check, never pass it.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="check-absent">Clean runs before auto-resolving</Label>
          <Input
            id="check-absent"
            type="number"
            min={1}
            max={10}
            value={absentRuns}
            onChange={(e) => setAbsentRuns(e.target.value)}
          />
          <p className="text-body-sm text-bone-gray">
            Use 2 or more for anything metric-driven, which naturally flaps.
          </p>
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-body-sm font-medium text-warm-off-white">
          Applies to
        </legend>
        <div className="flex gap-4">
          {WORKLOAD_KINDS.map((kind) => (
            <label
              key={kind}
              className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone"
            >
              <Checkbox
                checked={appliesTo.length === 0 || appliesTo.includes(kind)}
                onCheckedChange={() => toggleKind(kind)}
              />
              {kind}
            </label>
          ))}
        </div>
        <p className="text-body-sm text-bone-gray">
          Both (or neither) means every workload kind.
        </p>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-body-sm font-medium text-warm-off-white">
          Only for these technologies
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {WORKLOAD_TECHNOLOGIES.map((technology) => (
            <label
              key={technology}
              className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone"
            >
              <Checkbox
                checked={appliesToTechnologies.includes(technology)}
                onCheckedChange={() =>
                  toggleTechnology(technology, setAppliesToTechnologies)
                }
              />
              {TECHNOLOGY_LABEL[technology]}
            </label>
          ))}
        </div>
        <p className="text-body-sm text-bone-gray">
          Leave all unchecked for a technology-agnostic check. Note that ticking
          every box is <em>not</em> the same as leaving them empty: empty also
          reaches workloads whose technology was never identified, which a check
          written for a specific engine should not do.
        </p>
      </fieldset>

      <fieldset className="space-y-1.5">
        <legend className="text-body-sm font-medium text-warm-off-white">
          Never for these technologies
        </legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {WORKLOAD_TECHNOLOGIES.map((technology) => (
            <label
              key={technology}
              className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone"
            >
              <Checkbox
                checked={excludesTechnologies.includes(technology)}
                onCheckedChange={() =>
                  toggleTechnology(technology, setExcludesTechnologies)
                }
              />
              {TECHNOLOGY_LABEL[technology]}
            </label>
          ))}
        </div>
        <p className="text-body-sm text-bone-gray">
          Suppress this check where its generic form is a false positive, or where
          a technology-specific check already asks it better — otherwise both fire
          and one problem opens two concerns.
        </p>
      </fieldset>

      {error && <p className="text-body-sm text-traffic-red">{error}</p>}

      <Button type="submit" disabled={busy}>
        {busy ? "Saving…" : editing ? "Save check" : "Create check"}
      </Button>
    </form>
  );
}
