import { concernContentHash, concernFingerprint } from "./fingerprint";
import type { EffectiveCheck } from "./checks";
import {
  DISMISSED_STATUSES,
  compareSeverity,
  type Assessment,
  type ConcernStatus,
  type MonitorCategory,
  type Severity,
} from "./types";
import type {
  ConcernUpsert,
  ReconcilePlan,
} from "@/lib/db/monitoring-queries";

/**
 * The reconciliation POLICY, as a pure function: given what this run saw and
 * what the job already knows, decide which concerns open, which get reaffirmed
 * and which auto-resolve. No database access, so the rules are readable and
 * checkable in one place; `applyReconcilePlan` executes the result in a
 * transaction.
 *
 * The catalogue is passed IN rather than imported: it is live, per-job data now
 * (checks can be disabled or re-rated per job), and keeping this function pure
 * means the policy stays readable and the severities used here are exactly the
 * ones the prompt anchored Holmes on.
 *
 * The rule that matters most: a check the run could NOT evaluate
 * (`insufficient_data` — no Prometheus, RBAC denied, workload missing) leaves
 * its concern completely untouched. Treating missing telemetry as "the problem
 * went away" is how monitoring silently lies, so absence only counts when the
 * check actually ran (the gap kubescape's coverage score exists to close).
 */

/** The subset of a stored concern reconciliation needs. */
export interface ExistingConcern {
  id: string;
  fingerprint: string;
  checkId: string;
  status: ConcernStatus;
  effectiveSeverity: Severity;
  consecutiveRunsAbsent: number;
  targetKind: string;
  targetNamespace: string;
  targetName: string;
  scope: string;
}

function evaluatedKey(
  kind: string,
  namespace: string,
  name: string,
  checkId: string,
) {
  return `${kind}/${namespace}/${name}#${checkId}`;
}

export function buildReconcilePlan(input: {
  clusterId: string;
  category: MonitorCategory;
  /** The job's effective catalogue, keyed by check ID. */
  checks: Map<string, EffectiveCheck>;
  assessment: Assessment;
  existing: readonly ExistingConcern[];
}): ReconcilePlan {
  const { clusterId, category, checks, assessment, existing } = input;

  // ---- What failed in this run, keyed by identity ----
  const present = new Map<string, ConcernUpsert>();
  for (const finding of assessment.findings) {
    const check = checks.get(finding.checkId);
    if (!check) continue; // already filtered by validateAssessment; belt and braces
    const fingerprint = concernFingerprint({
      clusterId,
      checkId: finding.checkId,
      target: finding.target,
      scope: finding.scope,
    });
    const candidate: ConcernUpsert = {
      fingerprint,
      checkId: finding.checkId,
      checkVersion: check.version,
      category,
      targetKind: finding.target.kind,
      targetNamespace: finding.target.namespace,
      targetName: finding.target.name,
      scope: finding.scope,
      baseSeverity: check.baseSeverity,
      effectiveSeverity: finding.effectiveSeverity,
      severityRationale: finding.severityRationale,
      title: finding.title || check.title,
      rationale: finding.rationale,
      remediation: finding.remediation,
      evidence: finding.evidence,
      contentHash: concernContentHash(finding),
    };
    // Holmes is told not to repeat a check for the same target+scope; if it
    // does anyway, keep the more severe report rather than an arbitrary one.
    const prior = present.get(fingerprint);
    if (
      !prior ||
      compareSeverity(candidate.effectiveSeverity, prior.effectiveSeverity) < 0
    ) {
      present.set(fingerprint, candidate);
    }
  }

  // ---- What this run actually reached a verdict on ----
  const evaluated = new Set<string>();
  for (const entry of assessment.coverage.targets) {
    for (const checkId of entry.evaluated) {
      evaluated.add(
        evaluatedKey(
          entry.target.kind,
          entry.target.namespace,
          entry.target.name,
          checkId,
        ),
      );
    }
  }

  // ---- Diff against what the job already knows ----
  const absentIds: string[] = [];
  const autoResolveIds: string[] = [];
  const severityChanged = new Set<string>();

  for (const concern of existing) {
    const stillFailing = present.get(concern.fingerprint);
    if (stillFailing) {
      if (stillFailing.effectiveSeverity !== concern.effectiveSeverity)
        severityChanged.add(concern.fingerprint);
      continue;
    }

    // Not reported this run. Only meaningful if the check was evaluated —
    // otherwise we know nothing new and must not touch the concern.
    const wasEvaluated = evaluated.has(
      evaluatedKey(
        concern.targetKind,
        concern.targetNamespace,
        concern.targetName,
        concern.checkId,
      ),
    );
    if (!wasEvaluated) continue;

    // An already-resolved concern has nothing left to count down.
    const isLive =
      concern.status === "open" ||
      DISMISSED_STATUSES.includes(concern.status);
    if (!isLive) continue;

    absentIds.push(concern.id);
    const threshold = checks.get(concern.checkId)?.resolveAfterAbsentRuns ?? 1;
    if (
      concern.status === "open" &&
      concern.consecutiveRunsAbsent + 1 >= threshold
    ) {
      autoResolveIds.push(concern.id);
    }
  }

  return {
    present: [...present.values()],
    absentIds,
    autoResolveIds,
    severityChanged,
  };
}
