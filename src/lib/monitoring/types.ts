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

/**
 * The software running INSIDE the workload, as opposed to its Kubernetes kind.
 *
 * This is the dimension the generic rubric lacks: "is this StatefulSet healthy?"
 * and "is this PostgreSQL healthy?" are different questions, and only the second
 * one is worth asking. A check may be scoped to one or more technologies, and a
 * deep assessment loads that technology's playbook.
 *
 * Deliberately limited to what we can actually observe today. Kafka and ksqlDB
 * are absent on purpose: neither has a Holmes toolset or a Prometheus exporter in
 * this cluster, so a profile for them would produce confident nonsense. Adding
 * one later is this list plus a playbook plus checks — nothing else.
 */
export const WORKLOAD_TECHNOLOGIES = [
  "postgresql",
  "mysql",
  "mongodb",
  "clickhouse",
  "rabbitmq",
  "nodejs",
] as const;
export type WorkloadTechnology = (typeof WORKLOAD_TECHNOLOGIES)[number];

/**
 * How much work one run does per workload.
 *
 * `posture` is the original behaviour: one batched Holmes call for every target,
 * answering kind-generic configuration questions. Cheap enough to run often.
 *
 * `deep` is one investigation PER workload, with the technology's playbook in the
 * prompt, planning left on, and measured facts demanded back. Roughly an order of
 * magnitude more expensive, so it is meant for a weekly schedule or a button.
 */
export const MONITOR_DEPTHS = ["posture", "deep"] as const;
export type MonitorDepth = (typeof MONITOR_DEPTHS)[number];

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
  appliesToTechnologies: string[];
  excludesTechnologies: string[];
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

/**
 * A job target with the technology the inventory believes it runs — the shape the
 * runner works in. Kept separate from {@link AssessmentTarget} on purpose: that one
 * is the identity contract shared with Holmes and with the fingerprint, and must not
 * grow fields the model could contradict.
 *
 * `technology` is null when detection recognised nothing, or when the workload has
 * disappeared from the inventory since the job selected it. Both mean "no playbook",
 * and both are worth saying out loud rather than papering over.
 */
export interface ResolvedTarget extends AssessmentTarget {
  technology: WorkloadTechnology | null;
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

/**
 * Where a measured fact came from. The point of naming sources is that most of
 * them are unreachable from a manifest read: a fact tagged `metrics` or `engine`
 * is proof the agent actually queried Prometheus or the database, and its absence
 * is proof it did not. See `sourcesUsed` below.
 */
export const OBSERVATION_SOURCES = [
  /** The workload's own spec and status, via the kubernetes toolset. */
  "manifest",
  /** The node it runs on: capacity, pressure, kernel settings. */
  "node",
  /** PromQL against Prometheus. */
  "metrics",
  /** Pod logs or Loki. */
  "logs",
  /** The engine's own interface — SQL, management API, admin API. */
  "engine",
  /** Distributed traces. */
  "traces",
  /** The service's source code at the deployed ref. */
  "code",
] as const;
export type ObservationSource = (typeof OBSERVATION_SOURCES)[number];

/**
 * One measured fact, as opposed to a verdict. Deep assessments must return these
 * alongside their findings: a schema with fields that cannot be filled from
 * `kubectl get -o yaml` is what actually forces a multi-source investigation,
 * and an empty field is a visible, attributable gap rather than silence.
 *
 * `value` is always human-readable ("128MB", "false", "3.2"); `numeric` carries
 * the same fact as a number when it is one, which is what makes trends a query
 * rather than an LLM opinion.
 */
export interface AssessmentObservation {
  target: AssessmentTarget;
  /** Stable dotted key from the playbook, e.g. "wal.generation_bytes_per_day". */
  key: string;
  value: string;
  numeric: number | null;
  /** "bytes", "seconds", "%", "" — display only. */
  unit: string;
  source: ObservationSource;
}

export interface TargetCoverage {
  target: AssessmentTarget;
  /** Checks Holmes actually reached a verdict on — the reconciliation denominator. */
  evaluated: string[];
  /** Checks it could not judge, with the reason (missing telemetry, RBAC, …). */
  skipped: { checkId: string; reason: string }[];
  /**
   * Sources that produced at least one observation. DERIVED, never taken from
   * the model: you cannot claim to have queried Prometheus without returning a
   * metric-sourced fact. Empty on posture runs, which ask for no observations.
   */
  sourcesUsed: ObservationSource[];
  /** Sources the agent tried and got nothing from, with why. Model-reported. */
  sourcesUnavailable: { source: ObservationSource; reason: string }[];
}

export interface RunCoverage {
  targets: TargetCoverage[];
  summary: string;
}

export interface Assessment {
  findings: AssessmentFinding[];
  observations: AssessmentObservation[];
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

function parseSource(raw: unknown): ObservationSource | null {
  const source = str(raw, 40).toLowerCase();
  return (OBSERVATION_SOURCES as readonly string[]).includes(source)
    ? (source as ObservationSource)
    : null;
}

/**
 * A number the model may have written as "1234", "1.2e9" or "12%". Anything that
 * is not cleanly numeric stays null rather than being coerced — a wrong number in
 * a trend is worse than a missing one.
 */
function parseNumeric(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
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

  // A fact with no source is not a fact — it cannot be told apart from a guess,
  // so it is dropped rather than stored as evidence of an investigation.
  const observations: AssessmentObservation[] = [];
  const rawObservations = Array.isArray(root.observations)
    ? root.observations
    : [];
  for (const item of rawObservations) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const key = str(o.key, 120);
    if (!key) continue;
    const source = parseSource(o.source);
    if (!source) {
      rejected.push(`observation ${key}: missing or unknown source`);
      continue;
    }
    const target = resolveTarget(o.target, `observation ${key}`);
    if (!target) continue;
    observations.push({
      target,
      key,
      value: str(o.value, 2000),
      numeric: parseNumeric(o.numeric),
      unit: str(o.unit, 40),
      source,
    });
  }

  const targets: TargetCoverage[] = [];
  const byTarget = new Map<string, TargetCoverage>();
  const coverageFor = (target: AssessmentTarget): TargetCoverage => {
    const key = targetKey(target);
    let entry = byTarget.get(key);
    if (!entry) {
      entry = {
        target,
        evaluated: [],
        skipped: [],
        sourcesUsed: [],
        sourcesUnavailable: [],
      };
      byTarget.set(key, entry);
      targets.push(entry);
    }
    return entry;
  };

  const rawCoverage = Array.isArray(root.coverage) ? root.coverage : [];
  for (const item of rawCoverage) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const target = resolveTarget(c.target, "coverage");
    if (!target) continue;
    const entry = coverageFor(target);
    for (const id of Array.isArray(c.evaluated) ? c.evaluated : []) {
      const checkId = str(id, 60).toUpperCase();
      if (allowedChecks.has(checkId) && !entry.evaluated.includes(checkId))
        entry.evaluated.push(checkId);
    }
    for (const raw of Array.isArray(c.skipped) ? c.skipped : []) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const checkId = str(s.check_id, 60).toUpperCase();
      if (!allowedChecks.has(checkId)) continue;
      entry.skipped.push({ checkId, reason: str(s.reason, 500) });
    }
    for (const raw of Array.isArray(c.sources_unavailable)
      ? c.sources_unavailable
      : []) {
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const source = parseSource(s.source);
      if (!source) continue;
      entry.sourcesUnavailable.push({ source, reason: str(s.reason, 500) });
    }
  }

  // A finding on a target Holmes never reported coverage for is still real —
  // count it as evaluated so reconciliation can open the concern.
  for (const finding of findings) {
    const entry = coverageFor(finding.target);
    if (!entry.evaluated.includes(finding.checkId))
      entry.evaluated.push(finding.checkId);
  }

  // `sourcesUsed` is derived, never asserted: a source counts as reached only
  // because a fact came back from it.
  for (const observation of observations) {
    const entry = coverageFor(observation.target);
    if (!entry.sourcesUsed.includes(observation.source))
      entry.sourcesUsed.push(observation.source);
  }

  if (targets.length === 0 && findings.length === 0)
    throw new Error("Assessment reported neither coverage nor findings");

  return {
    findings,
    observations,
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
