"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Gauge, Microscope, Scan, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { SECURITY_SCOPE_CAVEAT } from "@/lib/monitoring/catalogue";
import { TARGET_LIMITS } from "@/lib/monitoring/job-input";
import { SCHEDULE_PRESETS } from "@/lib/monitoring/schedule";
import {
  CATEGORY_LABEL,
  DEPTH_BLURB,
  DEPTH_LABEL,
  TECHNOLOGY_LABEL,
} from "@/lib/monitoring/ui";
import { MONITOR_DEPTHS } from "@/lib/monitoring/types";
import type {
  AssessmentTarget,
  CheckView,
  MonitorCategory,
  MonitorDepth,
} from "@/lib/monitoring/types";
import {
  WorkloadPicker,
  targetKey,
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
  const [depth, setDepth] = useState<MonitorDepth>("posture");
  const [model, setModel] = useState(models[0] ?? "gpt-5-mini");
  const [schedule, setSchedule] = useState("");
  const [targets, setTargets] = useState<AssessmentTarget[]>([]);
  const [overrides, setOverrides] = useState<CheckOverride[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const limits = TARGET_LIMITS[depth];
  const byKey = useMemo(
    () => new Map(workloads.map((w) => [targetKey(w), w])),
    [workloads],
  );
  const picked = useMemo(
    () => targets.map((t) => byKey.get(targetKey(t))).filter((w) => w !== undefined),
    [targets, byKey],
  );
  const kinds = useMemo(
    () => [...new Set(targets.map((t) => t.kind))],
    [targets],
  );
  const technologies = useMemo(
    () => [...new Set(picked.map((w) => w.technology).filter((t) => t !== null))],
    [picked],
  );
  /**
   * Mirrors `applicableChecks` on the server, so the operator sees the same rubric
   * the run will use — including the technology dimension, which is why selecting a
   * Postgres workload makes the PG questions appear.
   */
  const applicable = useMemo(() => {
    const wantedKinds =
      kinds.length > 0 ? kinds : (["deployment", "statefulset"] as const);
    return checks.filter(
      (c) =>
        c.enabled &&
        c.category === type &&
        (c.appliesTo.length === 0 ||
          c.appliesTo.some((k) =>
            (wantedKinds as readonly string[]).includes(k),
          )) &&
        (c.appliesToTechnologies.length === 0 ||
          c.appliesToTechnologies.some((t) =>
            (technologies as readonly string[]).includes(t),
          )) &&
        !(
          c.excludesTechnologies.length > 0 &&
          technologies.length > 0 &&
          technologies.every((t) => c.excludesTechnologies.includes(t))
        ),
    );
  }, [checks, type, kinds, technologies]);

  /** Deep runs on unprofiled workloads still only ask the generic questions. */
  const unprofiled = useMemo(
    () => picked.filter((w) => !w.profiled),
    [picked],
  );

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
          depth,
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

      <fieldset className="space-y-2">
        <legend className="text-body-sm font-medium text-warm-off-white">
          How deeply?
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {MONITOR_DEPTHS.map((option) => {
            const Icon = option === "posture" ? Scan : Microscope;
            const active = depth === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDepth(option)}
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
                  {DEPTH_LABEL[option]}
                </span>
                <span className="mt-1 block text-body-sm text-bone-gray">
                  {DEPTH_BLURB[option]}
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
              targets.length > limits.soft
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
        {targets.length > limits.soft && (
          <p className="text-body-sm text-traffic-yellow">
            {depth === "deep"
              ? `Each workload is a separate full investigation, run one after another — ${targets.length} of them will take a long time and cost accordingly. The hard limit is ${limits.hard}.`
              : `One run covers every selected workload in a single investigation. Past about ${limits.soft} the agent's attention is spread thin and coverage gets less reliable — consider splitting this into several jobs.`}
          </p>
        )}
        {depth === "deep" && unprofiled.length > 0 && (
          <p className="text-body-sm text-bone-gray">
            No playbook exists yet for{" "}
            {unprofiled
              .map(
                (w) =>
                  `${w.name}${w.technology ? ` (${TECHNOLOGY_LABEL[w.technology]})` : ""}`,
              )
              .join(", ")}
            . {unprofiled.length === 1 ? "It" : "They"} will still be assessed,
            but only against the technology-agnostic checks — a deep run cannot
            invent a method it was not given.
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
