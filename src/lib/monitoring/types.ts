/**
 * Shared contracts for the monitoring module. Client-safe (no `server-only`):
 * the DB schema, the API routes and the admin UI all speak these types.
 *
 * Deliberately dependency-free so it can be imported from anywhere — the
 * assessment validator takes the set of legal check IDs as an argument instead
 * of importing the catalogue (which imports this file).
 */

export const SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Severity ordering for sorting and "worst finding" rollups. */
const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export function compareSeverity(a: Severity, b: Severity) {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export const MONITOR_CATEGORIES = ["security", "performance"] as const;
export type MonitorCategory = (typeof MONITOR_CATEGORIES)[number];

export const WORKLOAD_KINDS = ["deployment", "statefulset"] as const;
export type WorkloadKind = (typeof WORKLOAD_KINDS)[number];

export const RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ["manual", "schedule"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/**
 * Concern lifecycle. `resolved` is a human decision, `auto_resolved` is "the
 * check stopped failing" — kept distinct so a re-appearing concern can be told
 * apart from one someone signed off on.
 */
export const CONCERN_STATUSES = [
  "open",
  "resolved",
  "auto_resolved",
  "muted",
  "accepted_risk",
  "false_positive",
] as const;
export type ConcernStatus = (typeof CONCERN_STATUSES)[number];

/** Statuses a human set deliberately — reconciliation must not overwrite them. */
export const DISMISSED_STATUSES: readonly ConcernStatus[] = [
  "muted",
  "accepted_risk",
  "false_positive",
];

/**
 * A catalogue check as the UI sees it. The live rubric is a database table, so
 * client components receive checks in API payloads instead of importing them;
 * this is the one shape they all speak.
 */
export interface CheckView {
  id: string;
  category: MonitorCategory;
  title: string;
  question: string;
  evidence: string;
  reference: string;
  baseSeverity: Severity;
  appliesTo: string[];
  requires: string | null;
  resolveAfterAbsentRuns: number;
  builtin: boolean;
  enabled: boolean;
  version: number;
}

// ---- Assessment payload (what Holmes returns via response_format) ----

export interface MonitorEvidence {
  label: string;
  value: string;
}

export interface AssessmentTarget {
  kind: WorkloadKind;
  namespace: string;
  name: string;
}

export interface AssessmentFinding {
  checkId: string;
  target: AssessmentTarget;
  /** Sub-locus within the workload (container, volume, role); "" when whole-workload. */
  scope: string;
  effectiveSeverity: Severity;
  severityRationale: string;
  title: string;
  rationale: string;
  remediation: string;
  evidence: MonitorEvidence[];
}

export interface TargetCoverage {
  target: AssessmentTarget;
  /** Checks Holmes actually reached a verdict on — the reconciliation denominator. */
  evaluated: string[];
  /** Checks it could not judge, with the reason (missing telemetry, RBAC, …). */
  skipped: { checkId: string; reason: string }[];
}

export interface RunCoverage {
  targets: TargetCoverage[];
  summary: string;
}

export interface Assessment {
  findings: AssessmentFinding[];
  coverage: RunCoverage;
  /** Findings dropped during validation, surfaced on the run for honesty. */
  rejected: string[];
}

// ---- Validation ----

function str(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function targetKey(t: AssessmentTarget) {
  return `${t.kind}/${t.namespace}/${t.name}`;
}

export function targetLabel(t: AssessmentTarget) {
  return `${t.kind === "statefulset" ? "sts" : "deploy"}/${t.name}`;
}

function parseTarget(raw: unknown): AssessmentTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const kind = str(t.kind, 40).toLowerCase();
  if (!(WORKLOAD_KINDS as readonly string[]).includes(kind)) return null;
  const namespace = str(t.namespace, 253);
  const name = str(t.name, 253);
  if (!namespace || !name) return null;
  return { kind: kind as WorkloadKind, namespace, name };
}

function parseEvidence(raw: unknown): MonitorEvidence[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const e = item as Record<string, unknown>;
      const label = str(e.label, 120);
      const value = str(e.value, 2000);
      return label || value ? { label, value } : null;
    })
    .filter((e): e is MonitorEvidence => e !== null)
    .slice(0, 12);
}

/**
 * Turn Holmes's structured output into an {@link Assessment}, discarding
 * anything that would corrupt the history: unknown check IDs, checks from the
 * wrong category, and targets the job never selected. The model authors
 * evidence and prose — never identity — so a hallucinated check ID is dropped
 * rather than stored as a new concern.
 *
 * @param allowedChecks legal check IDs for this job's category
 * @param allowedTargets the job's selected workloads
 */
export function validateAssessment(
  parsed: unknown,
  allowedChecks: ReadonlySet<string>,
  allowedTargets: readonly AssessmentTarget[],
): Assessment {
  if (!parsed || typeof parsed !== "object")
    throw new Error("Assessment is not an object");
  const root = parsed as Record<string, unknown>;
  const targetIndex = new Map(allowedTargets.map((t) => [targetKey(t), t]));
  const rejected: string[] = [];

  const resolveTarget = (raw: unknown, what: string) => {
    const target = parseTarget(raw);
    if (!target) {
      rejected.push(`${what}: unparseable target`);
      return null;
    }
    const known = targetIndex.get(targetKey(target));
    if (!known) {
      rejected.push(`${what}: target ${targetLabel(target)} is not in this job`);
      return null;
    }
    return known;
  };

  const findings: AssessmentFinding[] = [];
  const rawFindings = Array.isArray(root.findings) ? root.findings : [];
  for (const item of rawFindings) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const checkId = str(f.check_id, 60).toUpperCase();
    if (!allowedChecks.has(checkId)) {
      rejected.push(`finding: unknown check ${checkId || "(blank)"}`);
      continue;
    }
    const target = resolveTarget(f.target, `finding ${checkId}`);
    if (!target) continue;
    const severity = str(f.effective_severity, 20).toLowerCase();
    findings.push({
      checkId,
      target,
      scope: str(f.scope, 253),
      effectiveSeverity: (SEVERITIES as readonly string[]).includes(severity)
        ? (severity as Severity)
        : "medium",
      severityRationale: str(f.severity_rationale, 1000),
      title: str(f.title, 200),
      rationale: str(f.rationale),
      remediation: str(f.remediation),
      evidence: parseEvidence(f.evidence),
    });
  }

  const targets: TargetCoverage[] = [];
  const rawCoverage = Array.isArray(root.coverage) ? root.coverage : [];
  for (const item of rawCoverage) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const target = resolveTarget(c.target, "coverage");
    if (!target) continue;
    const evaluated = (Array.isArray(c.evaluated) ? c.evaluated : [])
      .map((id) => str(id, 60).toUpperCase())
      .filter((id) => allowedChecks.has(id));
    const skipped = (Array.isArray(c.skipped) ? c.skipped : [])
      .map((raw) => {
        if (!raw || typeof raw !== "object") return null;
        const s = raw as Record<string, unknown>;
        const checkId = str(s.check_id, 60).toUpperCase();
        if (!allowedChecks.has(checkId)) return null;
        return { checkId, reason: str(s.reason, 500) };
      })
      .filter((s): s is { checkId: string; reason: string } => s !== null);
    targets.push({ target, evaluated, skipped });
  }

  // A finding on a target Holmes never reported coverage for is still real —
  // count it as evaluated so reconciliation can open the concern.
  for (const finding of findings) {
    const entry = targets.find(
      (t) => targetKey(t.target) === targetKey(finding.target),
    );
    if (!entry) {
      targets.push({
        target: finding.target,
        evaluated: [finding.checkId],
        skipped: [],
      });
    } else if (!entry.evaluated.includes(finding.checkId)) {
      entry.evaluated.push(finding.checkId);
    }
  }

  if (targets.length === 0 && findings.length === 0)
    throw new Error("Assessment reported neither coverage nor findings");

  return {
    findings,
    coverage: { targets, summary: str(root.summary, 4000) },
    rejected,
  };
}

/** Strip ``` fences, parse, validate — mirrors parseArtifactDraft(). */
export function parseAssessment(
  raw: string,
  allowedChecks: ReadonlySet<string>,
  allowedTargets: readonly AssessmentTarget[],
): Assessment {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("Assessment is not valid JSON");
  }
  return validateAssessment(parsed, allowedChecks, allowedTargets);
}
