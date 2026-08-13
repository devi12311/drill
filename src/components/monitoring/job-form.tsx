"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Gauge, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SECURITY_SCOPE_CAVEAT } from "@/lib/monitoring/catalogue";
import { TARGET_SOFT_LIMIT } from "@/lib/monitoring/job-input";
import { SCHEDULE_PRESETS } from "@/lib/monitoring/schedule";
import { CATEGORY_LABEL } from "@/lib/monitoring/ui";
import type {
  AssessmentTarget,
  CheckView,
  MonitorCategory,
} from "@/lib/monitoring/types";
import {
  WorkloadPicker,
  type PickableWorkload,
} from "./workload-picker";
import { RubricEditor, type CheckOverride } from "./rubric-editor";


const CATEGORY_BLURB: Record<MonitorCategory, string> = {
  security:
    "Pod Security Standards, RBAC exposure, network isolation, image pinning.",
  performance:
    "Restarts and OOM kills, replica availability, resource sizing and throttling, probes, disruption budgets.",
};

/**
 * Create a monitoring job. The check catalogue is shown up front — the point of
 * the rubric is that an operator can see exactly what will be assessed before
 * spending anything.
 */
export function JobForm({
  clusterId,
  workloads,
  models,
  checks,
}: {
  clusterId: string;
  workloads: PickableWorkload[];
  models: string[];
  /** The live catalogue; the job may disable or re-rate any of it. */
  checks: CheckView[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState<MonitorCategory>("security");
  const [model, setModel] = useState(models[0] ?? "gpt-5-mini");
  const [schedule, setSchedule] = useState("");
  const [targets, setTargets] = useState<AssessmentTarget[]>([]);
  const [overrides, setOverrides] = useState<CheckOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const kinds = useMemo(
    () => [...new Set(targets.map((t) => t.kind))],
    [targets],
  );
  // Only enabled catalogue checks in this category, narrowed to the kinds the
  // job actually targets — the same filtering the server applies at run time.
  const applicable = useMemo(() => {
    const wanted = kinds.length > 0 ? kinds : ["deployment", "statefulset"];
    return checks.filter(
      (c) =>
        c.enabled &&
        c.category === type &&
        (c.appliesTo.length === 0 ||
          c.appliesTo.some((k) => wanted.includes(k as typeof wanted[number]))),
    );
  }, [checks, type, kinds]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/monitoring/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clusterId,
          name,
          type,
          model,
          schedule: schedule || null,
          targets,
          overrides,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.refresh();
      router.push(`/admin/monitoring/${clusterId}/jobs/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the job");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="job-name">Name</Label>
        <Input
          id="job-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Production security posture"
          autoComplete="off"
          required
        />
      </div>

      <fieldset className="space-y-2">
        <legend className="text-body-sm font-medium text-warm-off-white">
          What should Holmes assess?
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["security", "performance"] as MonitorCategory[]).map((option) => {
            const Icon = option === "security" ? ShieldCheck : Gauge;
            const active = type === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                aria-pressed={active}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  active
                    ? "border-warm-off-white/40 bg-smoke-charcoal"
                    : "border-border hover:bg-smoke-charcoal",
                )}
              >
                <span className="flex items-center gap-2 text-body-sm text-warm-off-white">
                  <Icon className="size-4 text-bone-gray" />
                  {CATEGORY_LABEL[option]}
                </span>
                <span className="mt-1 block text-body-sm text-bone-gray">
                  {CATEGORY_BLURB[option]}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <Card className="space-y-3 p-4">
        <div className="space-y-1">
          <p className="text-caption-tracked uppercase text-bone-gray">
            The rubric for this job
          </p>
          <p className="text-body-sm text-bone-gray">
            Holmes answers exactly these questions. Uncheck one to leave it out
            of this job, or re-rate its severity for this job only — the
            catalogue itself is unchanged.
          </p>
        </div>
        <RubricEditor
          checks={applicable}
          overrides={overrides}
          onChange={setOverrides}
        />
        {type === "security" && (
          <p className="border-t border-border pt-2 text-body-sm text-bone-gray">
            {SECURITY_SCOPE_CAVEAT}
          </p>
        )}
      </Card>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label>Workloads to assess</Label>
          <span
            className={cn(
              "text-body-sm",
              targets.length > TARGET_SOFT_LIMIT
                ? "text-traffic-yellow"
                : "text-bone-gray",
            )}
          >
            {targets.length} selected
          </span>
        </div>
        <WorkloadPicker
          workloads={workloads}
          selected={targets}
          onChange={setTargets}
        />
        {targets.length > TARGET_SOFT_LIMIT && (
          <p className="text-body-sm text-traffic-yellow">
            One run covers every selected workload in a single investigation.
            Past about {TARGET_SOFT_LIMIT} the agent&apos;s attention is spread
            thin and coverage gets less reliable — consider splitting this into
            several jobs.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="job-model">Model</Label>
          <select
            id="job-model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-body-sm text-warm-off-white outline-none focus-visible:border-ring"
          >
            {models.map((option) => (
              <option key={option} value={option} className="bg-popover">
                {option}
              </option>
            ))}
          </select>
          <p className="text-body-sm text-bone-gray">
            A temperature-0 model gives the most comparable results run to run.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="job-schedule">Schedule (UTC cron, optional)</Label>
          <Input
            id="job-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 6 * * *"
            autoComplete="off"
            className="font-mono text-[12px]"
          />
          <div className="flex flex-wrap gap-1.5">
            {SCHEDULE_PRESETS.map((preset) => (
              <button
                key={preset.expression}
                type="button"
                onClick={() => setSchedule(preset.expression)}
                className="rounded-sm border border-border px-2 py-1 text-caption-tracked text-bone-gray transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white"
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-body-sm text-bone-gray">
            Leave empty to run only on demand. Scheduled firing needs the
            scheduler CronJob deployed; until then a schedule is recorded but
            nothing fires it automatically.
          </p>
        </div>
      </div>

      {error && <p className="text-body-sm text-traffic-red">{error}</p>}

      <Button type="submit" disabled={busy || targets.length === 0}>
        {busy ? "Creating…" : "Create job"}
      </Button>
    </form>
  );
}
