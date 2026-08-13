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
import { checkIndex, effectiveChecksForJob } from "./checks";
import { runAssessment, type AssessmentOutcome } from "./assess";
import { fixtureAssessment } from "./fixture";
import { buildReconcilePlan } from "./reconcile";

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

/** A run still `running` after this long lost its executor; the tick fails it. */
export const STALE_RUN_MS = 20 * 60 * 1000;

export interface DrainResult {
  executed: number;
  failed: number;
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
      "The job has no target workloads — select at least one Deployment or StatefulSet",
    );
    return;
  }

  // The job's effective rubric: catalogue checks that are enabled globally AND
  // for this job, applicable to the kinds it targets, with per-job severity
  // overrides applied — so the prompt anchors Holmes on the severities this job
  // actually cares about, and reconciliation uses the very same values.
  const kinds = [...new Set(targets.map((t) => t.kind))];
  const checks = await effectiveChecksForJob({
    jobId,
    category: job.type,
    kinds,
  });
  if (checks.length === 0) {
    await failRun(
      runId,
      "Every check for this job is disabled — enable at least one in the catalogue or the job's overrides",
    );
    return;
  }

  let outcome: AssessmentOutcome;
  try {
    // Fixture mode short-circuits BEFORE the cluster is touched, mirroring
    // conversations/[id]/resolve — UI work never costs an investigation.
    outcome = fixtureMode()
      ? await fixtureAssessment({
          category: job.type,
          model: job.model,
          targets,
          checks,
        })
      : await runAssessment({
          cluster,
          category: job.type,
          model: job.model,
          targets,
          checks,
        });
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
      checks: checkIndex(checks),
      assessment: outcome.assessment,
      existing,
    });
    await applyReconcilePlan(runId, jobId, plan, {
      coverage: outcome.assessment.coverage,
      rejected: outcome.assessment.rejected,
      rawResponse: outcome.meta.raw,
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
