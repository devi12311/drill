import "server-only";
import {
  applyReconcilePlan,
  claimQueuedRuns,
  claimRun,
  concernsForJob,
  failRun,
  getJobExecutionContext,
  unmuteExpired,
} from "@/lib/db/monitoring-queries";
import { fixtureMode } from "@/lib/holmes/stream";
import {
  checkIndex,
  jobRubricResolver,
  type EffectiveCheck,
  type JobRubric,
} from "./checks";
import {
  mergeOutcomes,
  runAssessment,
  type AssessmentOutcome,
} from "./assess";
import { fixtureAssessment } from "./fixture";
import type { ExpectedObservations, Playbook } from "./playbook";
import {
  NO_PLAYBOOKS,
  playbookResolver,
  type RunPlaybooks,
} from "./playbooks";
import { buildReconcilePlan } from "./reconcile";
import { targetLabel, type MonitorCategory, type ResolvedTarget } from "./types";

/**
 * Executes queued monitoring runs. The one place a run is turned into concerns.
 *
 * Both entry points funnel through `drainQueue`: the admin "Run now" button
 * (which enqueues then drains its own run) and the scheduler tick. Claiming via
 * `FOR UPDATE SKIP LOCKED` means overlapping ticks — and, later, extra worker
 * replicas — cannot execute the same run twice, with no change to this contract.
 */

/** Runs claimed per tick. Each is a full agentic investigation. */
export const TICK_CONCURRENCY = 2;

/**
 * How long a `running` row may sit before the tick decides its executor is gone.
 *
 * Two thresholds because the depths take honestly different amounts of time. A
 * posture run is one Holmes call capped at 300s, so 20 minutes is already generous.
 *
 * The deep figure is arithmetic, not a guess, and must stay in step with
 * `ASSESS_TIMEOUT_MS.deep` in assess.ts: 10 targets (the hard cap) × 20 minutes,
 * plus headroom for the one malformed-output retry, is ~4 hours of legitimate work.
 * Reaping earlier than that fails HEALTHY runs and discards investigations already
 * paid for — the same class of mistake as the old 300s call timeout. A dead deep run
 * therefore blocks its job for up to 6 hours, which is acceptable because deep jobs
 * are meant to be weekly.
 */
export const STALE_RUN_MS = {
  postureMs: 20 * 60 * 1000,
  deepMs: 6 * 60 * 60 * 1000,
};

export interface DrainResult {
  executed: number;
  failed: number;
}

type Cluster = NonNullable<
  Awaited<ReturnType<typeof getJobExecutionContext>>
>["cluster"];

interface AssessArgs {
  cluster: Cluster;
  category: MonitorCategory;
  model: string;
  targets: readonly ResolvedTarget[];
  checks: readonly EffectiveCheck[];
  /**
   * The method for this call, resolved by the caller. Only the per-workload deep
   * path supplies one, which is also the only path where a playbook MEANS
   * anything: a method is written for one instance of one technology.
   */
  playbook?: Playbook;
}

/**
 * One Holmes call, or the fixture standing in for it. Fixture mode short-circuits
 * BEFORE the cluster is touched, mirroring conversations/[id]/resolve — UI work
 * never costs an investigation.
 */
function assessOnce(
  args: AssessArgs,
  deep: boolean,
): Promise<AssessmentOutcome> {
  const { cluster, category, model, targets, checks, playbook } = args;
  return fixtureMode()
    ? fixtureAssessment({ category, model, targets, checks, playbook })
    : runAssessment({
        cluster,
        category,
        model,
        targets,
        checks,
        depth: deep ? "deep" : "posture",
        playbook,
      });
}

/**
 * A deep run: one investigation per target, sequentially.
 *
 * "Per target" rather than "per workload" because the cluster itself is a target
 * kind, and a cluster job has exactly one — so this loop runs once and the whole
 * mechanism below (its own rubric, its own method, its own failure isolation)
 * applies unchanged.
 *
 * Sequential for the same reason the queue drains serially — concurrent agentic
 * investigations hit LLM rate limits, which Holmes surfaces as SSE error_code 5204.
 *
 * A single workload's call failing does NOT fail the run. Its targets simply go
 * unevaluated, and reconciliation already treats "not evaluated" as "learn nothing,
 * change nothing" — so the other workloads' results are kept and the failure is
 * recorded where the run page shows it. Losing nine good assessments because the
 * tenth timed out would be the worse behaviour.
 */
async function assessPerWorkload(
  args: Omit<AssessArgs, "targets" | "checks" | "playbook">,
  targets: readonly ResolvedTarget[],
  rubric: JobRubric,
  playbooks: RunPlaybooks,
): Promise<{ outcomes: AssessmentOutcome[]; failures: string[] }> {
  const outcomes: AssessmentOutcome[] = [];
  const failures: string[] = [];
  for (const target of targets) {
    const checks = rubric(
      [target.kind],
      target.technology ? [target.technology] : [],
    );
    if (checks.length === 0) {
      failures.push(
        `${targetLabel(target)}: no enabled check applies to it — nothing was assessed`,
      );
      continue;
    }
    try {
      outcomes.push(
        await assessOnce(
          {
            ...args,
            targets: [target],
            checks,
            playbook: playbooks.for(target.technology),
          },
          true,
        ),
      );
    } catch (err) {
      failures.push(
        `${targetLabel(target)}: ${err instanceof Error ? err.message : "assessment failed"}`,
      );
    }
  }
  return { outcomes, failures };
}

/**
 * What this run was told to measure, stored on the run itself.
 *
 * Recorded for every target that had a method, INCLUDING one whose own call
 * failed: "which readings never came back" is the question the run page exists to
 * answer honestly, and a target that produced nothing is the sharpest case of it.
 */
function expectedObservations(
  targets: readonly ResolvedTarget[],
  playbooks: RunPlaybooks,
): ExpectedObservations[] {
  return targets.flatMap((target) => {
    const playbook = playbooks.for(target.technology);
    if (!playbook || !target.technology) return [];
    return [
      {
        target: {
          kind: target.kind,
          namespace: target.namespace,
          name: target.name,
        },
        technology: target.technology,
        keys: playbook.observations.map((spec) => spec.key),
      },
    ];
  });
}

async function executeRun(runId: string, jobId: string): Promise<void> {
  const context = await getJobExecutionContext(jobId);
  if (!context) {
    await failRun(runId, "The job disappeared before the run could start");
    return;
  }
  const { job, cluster, targets } = context;

  if (targets.length === 0) {
    await failRun(
      runId,
      "The job has no targets — select the cluster itself, or at least one Deployment or StatefulSet",
    );
    return;
  }

  // The job's effective rubric: catalogue checks that are enabled globally AND for
  // this job, applicable to the kinds and technologies it targets, with per-job
  // severity overrides applied — so the prompt anchors Holmes on the severities
  // this job actually cares about, and reconciliation uses the very same values.
  // Resolved ONCE here: a deep run re-filters it per workload, which is a different
  // view of the same data rather than a reason to re-query.
  const rubric = await jobRubricResolver(jobId, job.type);
  const deep = job.depth === "deep";
  // The methods, resolved ONCE here for the same reasons as the rubric — and one
  // more: they are editable live, so re-reading them per workload would let an
  // edit land mid-run and have two workloads in the same run measured by two
  // different methods. Posture runs carry no method at all.
  const playbooks = deep ? await playbookResolver() : NO_PLAYBOOKS;
  const kinds = [...new Set(targets.map((t) => t.kind))];
  const technologies = [
    ...new Set(targets.map((t) => t.technology).filter((t) => t !== null)),
  ];
  // The union across every target. A posture run asks exactly this set; a deep run
  // narrows it per workload but reconciliation still needs the union, because it
  // has to know the threshold and version of any check any workload was asked.
  const allChecks = rubric(kinds, technologies);
  if (allChecks.length === 0) {
    await failRun(
      runId,
      "Every check for this job is disabled — enable at least one in the catalogue or the job's overrides",
    );
    return;
  }

  const assessArgs = {
    cluster,
    category: job.type,
    model: job.model,
  };
  let outcome: AssessmentOutcome;
  let partialFailures: string[] = [];
  try {
    if (deep) {
      const { outcomes, failures } = await assessPerWorkload(
        assessArgs,
        targets,
        rubric,
        playbooks,
      );
      if (outcomes.length === 0) {
        await failRun(
          runId,
          `Nothing could be assessed. ${failures.join("; ")}`,
        );
        return;
      }
      outcome = mergeOutcomes(outcomes);
      partialFailures = failures;
    } else {
      outcome = await assessOnce(
        { ...assessArgs, targets, checks: allChecks },
        false,
      );
    }
  } catch (err) {
    await failRun(
      runId,
      err instanceof Error ? err.message : "Assessment failed",
    );
    return;
  }

  try {
    // Expire elapsed mute windows FIRST: reconciliation is what decides each
    // concern's status, so a mute that has run out must be open again before
    // the diff runs. The scheduler tick also does this, but it is not deployed
    // in v1 — without this, a 30-day mute would never end.
    await unmuteExpired();
    const existing = await concernsForJob(jobId);
    const plan = buildReconcilePlan({
      clusterId: cluster.id,
      category: job.type,
      checks: checkIndex(allChecks),
      assessment: outcome.assessment,
      existing,
    });
    await applyReconcilePlan(runId, jobId, plan, {
      coverage: outcome.assessment.coverage,
      observations: outcome.assessment.observations,
      // A workload whose own call failed is recorded beside the validation drops:
      // both answer "what is missing from this run", which is the question the run
      // page exists to answer honestly.
      rejected: [...outcome.assessment.rejected, ...partialFailures],
      rawResponse: outcome.meta.raw,
      expectedObservations: deep ? expectedObservations(targets, playbooks) : null,
      prompts: outcome.meta.prompts,
      model: outcome.meta.model,
      costUsd: outcome.meta.costUsd,
      totalTokens: outcome.meta.totalTokens,
      durationMs: outcome.meta.durationMs,
      toolCallsTotal: outcome.meta.toolCallsTotal,
      toolCallsFailed: outcome.meta.toolCallsFailed,
    });
  } catch (err) {
    // The assessment succeeded but persistence did not — record the cost so a
    // storage bug never looks free.
    await failRun(
      runId,
      `Assessment completed but could not be stored: ${
        err instanceof Error ? err.message : String(err)
      }`,
      {
        costUsd: outcome.meta.costUsd ?? undefined,
        totalTokens: outcome.meta.totalTokens ?? undefined,
        durationMs: outcome.meta.durationMs,
        model: outcome.meta.model,
        toolCallsTotal: outcome.meta.toolCallsTotal,
        toolCallsFailed: outcome.meta.toolCallsFailed,
      },
    );
  }
}

/**
 * `executeRun` records the failures it expects; this is the last resort, so an
 * unforeseen throw cannot strand a claimed run as `running` until the reaper.
 */
async function executeGuarded(run: {
  id: string;
  jobId: string;
}): Promise<boolean> {
  try {
    await executeRun(run.id, run.jobId);
    return true;
  } catch (err) {
    await failRun(
      run.id,
      err instanceof Error ? err.message : "Run failed unexpectedly",
    ).catch(() => null);
    return false;
  }
}

/**
 * Claim and execute up to `limit` queued runs. Runs execute sequentially: each
 * is an agentic investigation against a live cluster, and a scheduler tick
 * hammering several clusters at once is how you hit LLM rate limits (Holmes
 * surfaces those as SSE error_code 5204).
 */
export async function drainQueue(limit: number): Promise<DrainResult> {
  const claimed = await claimQueuedRuns(limit);
  let failed = 0;
  for (const run of claimed) {
    if (!(await executeGuarded(run))) failed++;
  }
  return { executed: claimed.length, failed };
}

/**
 * Execute ONE known run — the "Run now" path. Distinct from `drainQueue`
 * because the generic drain claims the oldest queued run, which may belong to
 * another job entirely. Returns false when something else already claimed it.
 */
export async function executeRunNow(runId: string): Promise<boolean> {
  const claimed = await claimRun(runId);
  if (!claimed) return false;
  await executeGuarded(claimed);
  return true;
}
