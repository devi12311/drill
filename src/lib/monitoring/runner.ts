import "server-only";
import {
  applyReconcilePlan,
  concernsForJob,
  failRun,
  finishRunTarget,
  getJobExecutionContext,
  heartbeatRun,
  prepareRun,
  runForFinalize,
  staleRunIds,
  startRunTarget,
  unmuteExpired,
} from "@/lib/db/monitoring-queries";
import { fixtureMode } from "@/lib/holmes/stream";
import {
  checkIndex,
  jobRubricResolver,
  type EffectiveCheck,
} from "./checks";
import {
  AssessmentError,
  mergeOutcomes,
  mergeRunMeta,
  runAssessment,
  type AssessmentOutcome,
  type AssessmentRunMeta,
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
 * Executes monitoring runs. The one place a run is turned into concerns.
 *
 * Only the worker's monitoring lane (lib/monitoring/worker.ts) calls in here: no HTTP request ever
 * waits on an investigation. A run goes through three steps —
 *
 *   prepare      snapshot the rubric and lay out one row per investigation
 *   investigate  call Holmes for each row, SAVING each result as it lands
 *   finalize     reconcile whatever completed, in one transaction
 *
 * — and finalize reads the saved rows rather than the worker's memory, so the same
 * function closes a run that finished, one that was cancelled, one whose worker was
 * shut down, and (from the reaper) one whose worker died.
 */

/** How often a worker proves it still holds its run — and checks for a Cancel. */
export const HEARTBEAT_MS = 20_000;

/**
 * Silence after which a running run's worker is presumed dead. Several missed
 * heartbeats, so one slow database write is not mistaken for a crash.
 */
const STALE_HEARTBEAT_MS = 2 * 60_000;

/** Why a run stopped before its last investigation. */
type Interruption = "cancel" | "shutdown" | "lost";

/**
 * The abort reason the runner passes down to Holmes. The stream rethrows the
 * caller's reason untouched (lib/holmes/sse.ts), which is how an interrupted
 * investigation is told apart from one that genuinely failed.
 */
class RunInterrupted extends Error {
  constructor(readonly why: Interruption) {
    super(INTERRUPTION_MESSAGE[why]);
  }
}

const INTERRUPTION_MESSAGE: Record<Interruption, string> = {
  cancel: "Cancelled before every investigation finished",
  shutdown: "The worker shut down mid-run (a restart or a release)",
  lost: "Another process finalized this run",
};

/** The same reasons, as recorded against the one investigation that was cut off. */
const INTERRUPTED_CALL: Record<Interruption, string> = {
  cancel: "cancelled",
  shutdown: "the worker shut down",
  lost: "the run was closed elsewhere",
};

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
  signal: AbortSignal,
): Promise<AssessmentOutcome> {
  const { cluster, category, model, targets, checks, playbook } = args;
  return fixtureMode()
    ? fixtureAssessment({ category, model, targets, checks, playbook, signal })
    : runAssessment({
        cluster,
        category,
        model,
        targets,
        checks,
        depth: deep ? "deep" : "posture",
        playbook,
        signal,
      });
}

/** One investigation as the worker holds it: its saved row plus how to ask it. */
interface PlannedInvestigation {
  rowId: string;
  targets: ResolvedTarget[];
  /** Empty when no enabled check applies — recorded as skipped, never called. */
  checks: EffectiveCheck[];
  playbook?: Playbook;
}

interface PreparedRun {
  assessArgs: Omit<AssessArgs, "targets" | "checks" | "playbook">;
  deep: boolean;
  plan: PlannedInvestigation[];
}

/**
 * Resolve everything the run needs, snapshot it, and lay out its investigations.
 * Returns null after failing the run itself when there is nothing to investigate.
 *
 * A deep run is one investigation per target — "per target" rather than "per
 * workload" because the cluster is a target kind too, so a cluster job is simply a
 * deep run of one. A posture run is ONE investigation covering every target.
 */
async function prepare(
  runId: string,
  jobId: string,
): Promise<PreparedRun | null> {
  const context = await getJobExecutionContext(jobId);
  if (!context) {
    await failRun(runId, "The job disappeared before the run could start");
    return null;
  }
  const { job, cluster, targets } = context;

  if (targets.length === 0) {
    await failRun(
      runId,
      "The job has no targets — select the cluster itself, or at least one Deployment or StatefulSet",
    );
    return null;
  }

  // The job's effective rubric: catalogue checks that are enabled globally AND for
  // this job, applicable to the kinds and technologies it targets, with per-job
  // severity overrides applied — so the prompt anchors Holmes on the severities
  // this job actually cares about, and reconciliation uses the very same values.
  // Resolved ONCE here: a deep run re-filters it per workload, which is a different
  // view of the same data rather than a reason to re-query.
  const rubric = await jobRubricResolver(jobId, job.type, cluster.orgId);
  const deep = job.depth === "deep";
  // The methods, resolved ONCE here for the same reasons as the rubric — and one
  // more: they are editable live, so re-reading them per workload would let an
  // edit land mid-run and have two workloads in the same run measured by two
  // different methods. Posture runs carry no method at all.
  const playbooks = deep ? await playbookResolver(cluster.orgId) : NO_PLAYBOOKS;
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
    return null;
  }

  const layout = deep
    ? targets.map((target) => ({
        label: targetLabel(target),
        targets: [target],
        checks: rubric([target.kind], target.technology ? [target.technology] : []),
        playbook: playbooks.for(target.technology),
      }))
    : [
        {
          label: `${targets.length} workload${targets.length === 1 ? "" : "s"}`,
          targets: [...targets],
          checks: allChecks,
          playbook: undefined,
        },
      ];

  const rows = await prepareRun(runId, {
    rubricSnapshot: allChecks,
    expectedObservations: deep ? expectedObservations(targets, playbooks) : null,
    targets: layout.map(({ label, targets }) => ({ label, targets })),
  });
  // Matched by position: RETURNING order is not something Postgres promises.
  const rowAt = new Map(rows.map((r) => [r.position, r.id]));
  return {
    assessArgs: { cluster, category: job.type, model: job.model },
    deep,
    plan: layout.map((entry, i) => ({ ...entry, rowId: rowAt.get(i)! })),
  };
}

/**
 * Call Holmes for each planned investigation, sequentially, saving each result the
 * moment it lands. Sequential for the same reason the worker runs one job at a
 * time — concurrent agentic investigations hit LLM rate limits, which Holmes
 * surfaces as SSE error_code 5204.
 *
 * One investigation failing does NOT stop the others. Its targets simply go
 * unevaluated, and reconciliation already treats "not evaluated" as "learn nothing,
 * change nothing" — losing nine good assessments because the tenth timed out would
 * be the worse behaviour. Only an abort (cancel, shutdown) stops the loop.
 */
async function investigate(
  prepared: PreparedRun,
  signal: AbortSignal,
): Promise<void> {
  const { assessArgs, deep, plan } = prepared;
  for (const step of plan) {
    if (signal.aborted) return;
    if (step.checks.length === 0) {
      await finishRunTarget(step.rowId, {
        status: "skipped",
        error: "no enabled check applies to it — nothing was assessed",
      });
      continue;
    }
    await startRunTarget(step.rowId);
    try {
      const outcome = await assessOnce(
        {
          ...assessArgs,
          targets: step.targets,
          checks: step.checks,
          playbook: step.playbook,
        },
        deep,
        signal,
      );
      await finishRunTarget(step.rowId, { status: "completed", outcome });
    } catch (err) {
      await finishRunTarget(step.rowId, {
        status: "failed",
        error: signal.aborted
          ? `interrupted — ${INTERRUPTED_CALL[interruptionOf(signal)]}`
          : err instanceof Error
            ? err.message
            : "assessment failed",
        // What the call still cost and did, counted in the run's totals.
        failedMeta: err instanceof AssessmentError ? err.meta : undefined,
      });
    }
  }
}

function interruptionOf(signal: AbortSignal): Interruption {
  return signal.reason instanceof RunInterrupted ? signal.reason.why : "shutdown";
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

/** The columns a failed run keeps, so it can be diagnosed and never looks free. */
function failureRecord(meta: AssessmentRunMeta) {
  return {
    costUsd: meta.costUsd ?? undefined,
    totalTokens: meta.totalTokens ?? undefined,
    durationMs: meta.durationMs,
    model: meta.model,
    toolCallsTotal: meta.toolCallsTotal,
    toolCallsFailed: meta.toolCallsFailed,
    // Includes an answer that failed validation, which is the only way to tell
    // "the model returned prose" from "it returned an empty object".
    rawResponse: meta.raw,
    prompts: meta.prompts,
  };
}

/**
 * Close a run from its saved investigations — the ONLY way a run reaches a
 * terminal state with findings. `interrupted` is set when the run stopped short
 * (cancel, shutdown, dead worker): what completed is still reconciled, the rest is
 * named as not assessed, and the run ends `failed` or `cancelled` with the reason.
 *
 * Safe to race: the worker and the reaper may both try, and the commit only
 * matches a run still `running`.
 */
export async function finalizeRun(
  runId: string,
  interrupted?: { status: "failed" | "cancelled"; error: string },
): Promise<void> {
  const run = await runForFinalize(runId);
  if (!run || run.status !== "running") return;
  const status = interrupted?.status ?? "failed";

  const completed = run.targets.flatMap((t) =>
    t.status === "completed" && t.outcome ? [t.outcome] : [],
  );
  const failedMeta = run.targets.flatMap((t) =>
    t.failedMeta ? [t.failedMeta] : [],
  );
  const failures = run.targets
    .filter((t) => t.status === "failed" || t.status === "skipped")
    .map((t) => `${t.label}: ${t.error ?? "failed"}`);
  const notReached = run.targets
    .filter((t) => t.status === "pending" || t.status === "running")
    .map((t) => t.label);
  const costOfFailures = failedMeta.length
    ? failureRecord(mergeRunMeta(failedMeta))
    : {};

  // A run claimed before snapshots existed cannot be graded honestly.
  if (completed.length === 0 || !run.rubricSnapshot) {
    const reason =
      interrupted?.error ??
      (run.targets.length === 1 && run.targets[0].error
        ? run.targets[0].error
        : `Nothing could be assessed. ${failures.join("; ")}`);
    await failRun(runId, reason, costOfFailures, status);
    return;
  }

  const merged = mergeOutcomes(completed);
  const meta = mergeRunMeta([merged.meta, ...failedMeta]);
  try {
    // Expire elapsed mute windows FIRST: reconciliation is what decides each
    // concern's status, so a mute that has run out must be open again before
    // the diff runs.
    await unmuteExpired();
    const existing = await concernsForJob(run.jobId);
    const plan = buildReconcilePlan({
      clusterId: run.clusterId,
      category: run.category,
      checks: checkIndex(run.rubricSnapshot),
      assessment: merged.assessment,
      existing,
    });
    await applyReconcilePlan(
      runId,
      run.jobId,
      plan,
      {
        coverage: merged.assessment.coverage,
        observations: merged.assessment.observations,
        // Everything missing from this run, in one place — validation drops, failed
        // investigations and the ones an interruption never reached — because that
        // is the question the run page exists to answer honestly.
        rejected: [
          ...merged.assessment.rejected,
          ...failures,
          ...(notReached.length
            ? [`Not assessed (${interrupted?.error ?? "interrupted"}): ${notReached.join(", ")}`]
            : []),
        ],
        rawResponse: meta.raw,
        prompts: meta.prompts,
        model: meta.model,
        costUsd: meta.costUsd,
        totalTokens: meta.totalTokens,
        durationMs: meta.durationMs,
        toolCallsTotal: meta.toolCallsTotal,
        toolCallsFailed: meta.toolCallsFailed,
      },
      interrupted,
    );
  } catch (err) {
    // The assessment succeeded but persistence did not — record the cost so a
    // storage bug never looks free.
    await failRun(
      runId,
      `Assessment completed but could not be stored: ${
        err instanceof Error ? err.message : String(err)
      }`,
      failureRecord(meta),
    );
  }
}

/**
 * Execute one claimed run, holding it with a heartbeat for as long as it lasts.
 *
 * The heartbeat is also the cancel channel: its write returns whether someone
 * pressed Cancel, and returns nothing at all when the run was closed elsewhere
 * (reaped while this process stalled), in which case the worker stops writing.
 * `shutdown` is the worker's own signal, fired on SIGTERM.
 */
export async function executeClaimedRun(
  run: { id: string; jobId: string },
  shutdown: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const stop = (why: Interruption) => {
    if (!controller.signal.aborted) controller.abort(new RunInterrupted(why));
  };
  const onShutdown = () => stop("shutdown");
  shutdown.addEventListener("abort", onShutdown, { once: true });
  const heartbeat = setInterval(() => {
    heartbeatRun(run.id)
      .then((beat) => {
        if (!beat) stop("lost");
        else if (beat.cancelRequested) stop("cancel");
      })
      // A missed beat is not fatal; enough of them and the reaper decides.
      .catch(() => null);
  }, HEARTBEAT_MS);

  try {
    // A cancel pressed between the claim and the first beat must not be missed.
    const first = await heartbeatRun(run.id);
    if (first?.cancelRequested) stop("cancel");
    if (!first) return;
    const prepared = await prepare(run.id, run.jobId);
    if (!prepared) return;
    await investigate(prepared, controller.signal);
    if (!controller.signal.aborted) return await finalizeRun(run.id);
    const why = interruptionOf(controller.signal);
    if (why === "lost") return;
    await finalizeRun(run.id, {
      status: why === "cancel" ? "cancelled" : "failed",
      error: INTERRUPTION_MESSAGE[why],
    });
  } catch (err) {
    // The last resort: an unforeseen throw must not strand the run as `running`
    // until the reaper notices.
    await failRun(
      run.id,
      err instanceof Error ? err.message : "Run failed unexpectedly",
    ).catch(() => null);
  } finally {
    clearInterval(heartbeat);
    shutdown.removeEventListener("abort", onShutdown);
  }
}

/**
 * Crash recovery: close every run whose worker has gone quiet, keeping whatever
 * it finished. Called by the worker's housekeeping and by the scheduler tick.
 */
export async function reapStaleRuns(): Promise<number> {
  const stale = await staleRunIds(STALE_HEARTBEAT_MS);
  for (const id of stale) {
    await finalizeRun(id, {
      status: "failed",
      error:
        "The worker running this stopped responding (it crashed or was killed)",
    });
  }
  return stale.length;
}
