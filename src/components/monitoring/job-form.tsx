"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Gauge, Microscope, Scan, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  CLUSTER_TARGET,
  MONITOR_DEPTHS,
  WORKLOAD_KINDS,
  isClusterTarget,
} from "@/lib/monitoring/types";
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

/** An existing job, as the form needs it. Its presence switches to edit mode. */
export interface EditableJob {
  id: string;
  name: string;
  type: MonitorCategory;
  depth: MonitorDepth;
  model: string;
  schedule: string | null;
  enabled: boolean;
  targets: AssessmentTarget[];
  overrides: CheckOverride[];
}

/** Everything an edit can change — and therefore what the PATCH body carries. */
interface JobDraft {
  name: string;
  depth: MonitorDepth;
  model: string;
  schedule: string | null;
  enabled: boolean;
  targets: AssessmentTarget[];
  overrides: CheckOverride[];
}

/**
 * Order-insensitive over the two list fields: unticking a workload and ticking it
 * again must not leave the job looking edited, or "Save changes" stops meaning
 * anything and every visit writes an audit row.
 */
function sameDraft(a: JobDraft, b: JobDraft) {
  const key = (draft: JobDraft) =>
    JSON.stringify({
      ...draft,
      targets: draft.targets.map(targetKey).sort(),
      overrides: draft.overrides
        .map((o) => `${o.checkId}:${o.enabled}:${o.severityOverride ?? ""}`)
        .sort(),
    });
  return key(a) === key(b);
}

/**
 * Create or retune a monitoring job. The check catalogue is shown up front — the
 * point of the rubric is that an operator can see exactly what will be assessed
 * before spending anything.
 *
 * One form for both modes, because the two would otherwise have to agree
 * independently on the target limits, the cluster/depth coupling and the rubric
 * preview — three rules that are only correct while they are stated once. What
 * edit mode cannot change is the category: see the note in the fieldset.
 */
export function JobForm({
  clusterId,
  workloads,
  models,
  checks,
  startOnCluster = false,
  job,
}: {
  clusterId: string;
  workloads: PickableWorkload[];
  models: string[];
  /** The live catalogue; the job may disable or re-rate any of it. */
  checks: CheckView[];
  /**
   * Open with the cluster itself selected — the cluster page's "Assess this
   * cluster" shortcut. A seeded initial state rather than an effect, so nothing
   * overwrites the operator's edits on a later render.
   */
  startOnCluster?: boolean;
  /** Omitted to create; supplied to edit that job in place. */
  job?: EditableJob;
}) {
  const router = useRouter();
  const [name, setName] = useState(job?.name ?? "");
  const [type, setType] = useState<MonitorCategory>(
    job?.type ?? (startOnCluster ? "performance" : "security"),
  );
  const [depth, setDepth] = useState<MonitorDepth>(
    job?.depth ?? (startOnCluster ? "deep" : "posture"),
  );
  const [model, setModel] = useState(job?.model ?? models[0] ?? "gpt-5-mini");
  const [schedule, setSchedule] = useState(job?.schedule ?? "");
  const [enabled, setEnabled] = useState(job?.enabled ?? true);
  const [targets, setTargets] = useState<AssessmentTarget[]>(
    job?.targets ?? (startOnCluster ? [CLUSTER_TARGET] : []),
  );
  const [overrides, setOverrides] = useState<CheckOverride[]>(
    job?.overrides ?? [],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cluster = targets.some(isClusterTarget);
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
    () =>
      targets.some(isClusterTarget)
        ? // The cluster's technology comes from the target kind, not from the
          // workload inventory — there is no inventory row for it to be detected on.
          (["kubernetes"] as const)
        : [...new Set(picked.map((w) => w.technology).filter((t) => t !== null))],
    [picked, targets],
  );
  /**
   * Mirrors `applicableChecks` on the server, so the operator sees the same rubric
   * the run will use — including the technology dimension, which is why selecting a
   * Postgres workload makes the PG questions appear.
   */
  const applicable = useMemo(() => {
    const wantedKinds = kinds.length > 0 ? kinds : WORKLOAD_KINDS;
    return checks.filter(
      (c) =>
        c.enabled &&
        c.category === type &&
        // An empty `appliesTo` means every WORKLOAD kind and never the cluster —
        // same rule as applicableChecks(), which this preview exists to mirror.
        (c.appliesTo.length ? c.appliesTo : WORKLOAD_KINDS).some((k) =>
          (wantedKinds as readonly string[]).includes(k),
        ) &&
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

  /**
   * A job's model outlives the cluster's model list — an entry can be commented
   * out of Holmes's config long after a job was pointed at it. Keeping the stored
   * value in the options means the select shows what will actually be sent instead
   * of rendering blank and silently saving something else.
   */
  const modelOptions = useMemo(
    () => (models.includes(model) ? models : [model, ...models]),
    [models, model],
  );

  const draft: JobDraft = useMemo(
    () => ({
      name,
      depth,
      model,
      schedule: schedule || null,
      enabled,
      targets,
      overrides,
    }),
    [name, depth, model, schedule, enabled, targets, overrides],
  );
  /** What is stored, moved forward on every successful save. */
  const [baseline, setBaseline] = useState<JobDraft | null>(
    job
      ? {
          name: job.name,
          depth: job.depth,
          model: job.model,
          schedule: job.schedule,
          enabled: job.enabled,
          targets: job.targets,
          overrides: job.overrides,
        }
      : null,
  );
  const dirty = baseline === null || !sameDraft(draft, baseline);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        job
          ? `/api/admin/monitoring/jobs/${job.id}`
          : "/api/admin/monitoring/jobs",
        {
          method: job ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          // `type` is create-only, and PATCH ignores it — see the fieldset note.
          body: JSON.stringify(job ? draft : { clusterId, type, ...draft }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // Re-runs the layout, so the tree picks up the new name / paused state.
      router.refresh();
      if (!job) {
        // Deliberately still busy: the button is about to be unmounted by the
        // navigation, and re-enabling it invites a second create on a slow push.
        router.push(`/admin/monitoring/${clusterId}/jobs/${body.id}`);
        return;
      }
      setBaseline(draft);
      // Unchecking a check closes the concerns citing it, server-side. Saying so
      // is the only way the operator learns their history just moved.
      const closed: number = body.autoResolved ?? 0;
      setSaved(
        closed === 0
          ? "Saved."
          : closed === 1
            ? "Saved. One open concern was resolved, because the check it cites no longer runs in this job."
            : `Saved. ${closed} open concerns were resolved, because the checks they cite no longer run in this job.`,
      );
      setBusy(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Could not ${job ? "save the changes" : "create the job"}`,
      );
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
        {job && (
          <p className="text-body-sm text-bone-gray">
            Fixed after creation. Every concern this job has recorded cites a
            check from this category, and switching would leave those concerns
            open forever because nothing would ever assess them again — create a
            second job for the other category.
          </p>
        )}
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
                disabled={Boolean(job)}
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  active
                    ? "border-warm-off-white/40 bg-smoke-charcoal"
                    : "border-border",
                  job
                    ? ["cursor-not-allowed", !active && "opacity-40"]
                    : "hover:bg-smoke-charcoal",
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
            // Every cluster check needs measured data and a method to find it with.
            // A posture run carries no playbook, so it would ask them all and skip
            // most — a worse deep run that still costs a call.
            const unavailable = cluster && option === "posture";
            return (
              <button
                key={option}
                type="button"
                onClick={() => setDepth(option)}
                aria-pressed={active}
                disabled={unavailable}
                title={
                  unavailable
                    ? "A cluster assessment is always deep: its questions need measurements, and only a deep run carries the method that finds them."
                    : undefined
                }
                className={cn(
                  "rounded-lg border p-4 text-left transition-colors",
                  active
                    ? "border-warm-off-white/40 bg-smoke-charcoal"
                    : "border-border hover:bg-smoke-charcoal",
                  unavailable && "cursor-not-allowed opacity-40 hover:bg-transparent",
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
            {job &&
              " Unchecking one also resolves the open concerns that cite it, since nothing will assess them from now on."}
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
          <Label>What to assess</Label>
          <span
            className={cn(
              "text-body-sm",
              !cluster && targets.length > limits.soft
                ? "text-traffic-yellow"
                : "text-bone-gray",
            )}
          >
            {cluster ? "the cluster" : `${targets.length} selected`}
          </span>
        </div>
        <WorkloadPicker
          workloads={workloads}
          selected={targets}
          onChange={(next) => {
            setTargets(next);
            // Selecting the cluster must actually change the depth, not merely grey
            // out the other option: a posture cluster run would be accepted by the
            // server and produce a run with no method.
            if (next.some(isClusterTarget)) setDepth("deep");
          }}
        />
        {cluster && (
          <p className="text-body-sm text-bone-gray">
            One investigation covering the control plane, etcd, every node,
            scheduling, DNS, the pod network, storage and clusterwide workload
            health. It is the longest single run in the system — expect tens of
            minutes — and findings are addressed to the node, namespace or component
            they are about, so each keeps its own history.
          </p>
        )}
        {cluster && applicable.length === 0 && (
          <p className="text-body-sm text-traffic-yellow">
            No {CATEGORY_LABEL[type].toLowerCase()} check is scoped to the cluster,
            so this job would assess nothing. Only performance and reliability
            checks ship for the cluster today; switch the category, or author a
            cluster-scoped check in the catalogue first.
          </p>
        )}
        {!cluster && targets.length > limits.soft && (
          <p className="text-body-sm text-traffic-yellow">
            {depth === "deep"
              ? `Each workload is a separate full investigation, run one after another — ${targets.length} of them will take a long time and cost accordingly. The hard limit is ${limits.hard}.`
              : `One run covers every selected workload in a single investigation. Past about ${limits.soft} the agent's attention is spread thin and coverage gets less reliable — consider splitting this into several jobs.`}
          </p>
        )}
        {!cluster && depth === "deep" && unprofiled.length > 0 && (
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
            {modelOptions.map((option) => (
              <option key={option} value={option} className="bg-popover">
                {option}
              </option>
            ))}
          </select>
          <p className="text-body-sm text-bone-gray">
            A temperature-0 model gives the most comparable results run to run.
            {!models.includes(model) &&
              " This cluster's Holmes does not currently serve the model this job is set to."}
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

      {/* Pausing only makes sense once there is a job to pause; a new one is
          created active, which is what the create button already says. */}
      {job && (
        <label className="flex cursor-pointer items-start gap-2.5">
          <Checkbox
            checked={enabled}
            onCheckedChange={(value) => setEnabled(value === true)}
            className="mt-0.5"
          />
          <span>
            <span className="block text-body-sm text-warm-off-white">
              Active
            </span>
            <span className="block text-body-sm text-bone-gray">
              Pausing stops the schedule and nothing else: the concern history
              stays, and &ldquo;Run now&rdquo; still works. Re-activating counts
              the next fire time from then, so a paused stretch never fires as a
              burst of catch-up runs.
            </span>
          </span>
        </label>
      )}

      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      {saved && !dirty && (
        <p className="text-body-sm text-traffic-green">{saved}</p>
      )}

      <Button
        type="submit"
        disabled={busy || targets.length === 0 || (Boolean(job) && !dirty)}
      >
        {job
          ? busy
            ? "Saving…"
            : "Save changes"
          : busy
            ? "Creating…"
            : "Create job"}
      </Button>
    </form>
  );
}
