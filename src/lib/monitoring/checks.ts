import "server-only";
import {
  listAllChecks,
  listJobOverrides,
  seedBuiltinChecks,
  type CheckRow,
  type JobCheckOverride,
} from "@/lib/db/monitoring-queries";
import {
  BUILTIN_CHECKS,
  applicableChecks,
  type CheckRequirement,
  type MonitorCheck,
} from "./catalogue";
import type {
  CheckView,
  MonitorCategory,
  TargetKind,
  WorkloadTechnology,
} from "./types";

/**
 * Reads the LIVE rubric — the `monitoring_checks` table — and resolves it for a
 * given job. Everything that assesses or reconciles goes through here; nothing
 * outside this module should read `BUILTIN_CHECKS`, which is only the seed.
 */

/** A check as it applies to one job: catalogue values plus any job override. */
export interface EffectiveCheck extends MonitorCheck {
  /** The check's own version, stamped onto concerns raised under it. */
  version: number;
  /** True when this job overrides the catalogue's base severity. */
  severityOverridden: boolean;
}

function toMonitorCheck(row: CheckRow): MonitorCheck & { version: number } {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    question: row.question,
    evidence: row.evidence,
    reference: row.reference,
    baseSeverity: row.baseSeverity,
    appliesTo: row.appliesTo.length
      ? (row.appliesTo as TargetKind[])
      : undefined,
    appliesToTechnologies: row.appliesToTechnologies.length
      ? (row.appliesToTechnologies as WorkloadTechnology[])
      : undefined,
    excludesTechnologies: row.excludesTechnologies.length
      ? (row.excludesTechnologies as WorkloadTechnology[])
      : undefined,
    requires: (row.requires as CheckRequirement | null) ?? undefined,
    resolveAfterAbsentRuns: row.resolveAfterAbsentRuns,
    version: row.version,
  };
}

/**
 * Idempotently seed the built-in rubric, once per process.
 *
 * Insert-if-missing only — an admin's retune or disable of a built-in must
 * survive every restart, so this never updates an existing row. A new built-in
 * shipped in a later release appears automatically on next boot.
 */
let seeded: Promise<void> | null = null;

export function ensureBuiltinChecks(): Promise<void> {
  seeded ??= seedBuiltinChecks(
    BUILTIN_CHECKS.map((c) => ({
      id: c.id,
      category: c.category,
      title: c.title,
      question: c.question,
      evidence: c.evidence,
      reference: c.reference,
      baseSeverity: c.baseSeverity,
      appliesTo: c.appliesTo ?? [],
      appliesToTechnologies: c.appliesToTechnologies ?? [],
      excludesTechnologies: c.excludesTechnologies ?? [],
      requires: c.requires ?? null,
      resolveAfterAbsentRuns: c.resolveAfterAbsentRuns ?? 1,
      builtin: true,
    })),
  ).then(() => undefined);
  // A failed seed must not be cached as "done", or the catalogue stays empty
  // until the process restarts.
  seeded.catch(() => {
    seeded = null;
  });
  return seeded;
}

/** Every check in the live catalogue, including disabled ones. */
export async function liveChecks(): Promise<CheckRow[]> {
  await ensureBuiltinChecks();
  return listAllChecks();
}

function applyOverrides(
  checks: (MonitorCheck & { version: number })[],
  overrides: JobCheckOverride[],
): EffectiveCheck[] {
  const byId = new Map(overrides.map((o) => [o.checkId, o]));
  return checks
    .filter((c) => byId.get(c.id)?.enabled !== false)
    .map((c) => {
      const override = byId.get(c.id);
      return {
        ...c,
        baseSeverity: override?.severityOverride ?? c.baseSeverity,
        severityOverridden: Boolean(override?.severityOverride),
      };
    });
}

/**
 * The checks a job will actually be assessed against: enabled in the catalogue,
 * enabled for this job, applicable to the workload kinds it targets, with any
 * per-job severity override already applied — so the prompt anchors Holmes on
 * the severity this job actually cares about.
 */
/**
 * Resolve the job's rubric, then narrow it per workload as often as needed.
 *
 * Fetched once and reusable because a deep run resolves the rubric PER workload —
 * different kind, different technology, therefore different questions — and doing
 * that with a round trip each would query the catalogue N times to get N filtered
 * views of identical data.
 */
export type JobRubric = (
  kinds: readonly TargetKind[],
  technologies: readonly WorkloadTechnology[],
) => EffectiveCheck[];

export async function jobRubricResolver(
  jobId: string,
  category: MonitorCategory,
): Promise<JobRubric> {
  const [rows, overrides] = await Promise.all([
    liveChecks(),
    listJobOverrides(jobId),
  ]);
  const enabled = rows.filter((r) => r.enabled).map(toMonitorCheck);
  return (kinds, technologies) =>
    applyOverrides(
      applicableChecks(enabled, category, kinds, technologies),
      overrides,
    );
}

/** Lookup keyed by ID, for reconciliation. */
export function checkIndex(
  checks: readonly EffectiveCheck[],
): Map<string, EffectiveCheck> {
  return new Map(checks.map((c) => [c.id, c]));
}

/** The catalogue in the client-facing shape (see CheckView in ./types). */
export async function checkSummaries(): Promise<CheckView[]> {
  return (await liveChecks()).map((c) => ({
    id: c.id,
    category: c.category,
    title: c.title,
    question: c.question,
    evidence: c.evidence,
    reference: c.reference,
    baseSeverity: c.baseSeverity,
    appliesTo: c.appliesTo,
    appliesToTechnologies: c.appliesToTechnologies,
    excludesTechnologies: c.excludesTechnologies,
    requires: c.requires,
    resolveAfterAbsentRuns: c.resolveAfterAbsentRuns,
    builtin: c.builtin,
    enabled: c.enabled,
    version: c.version,
  }));
}
