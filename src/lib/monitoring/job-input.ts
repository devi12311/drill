import {
  MONITOR_DEPTHS,
  SEVERITIES,
  WORKLOAD_KINDS,
  type AssessmentTarget,
  type MonitorDepth,
  type Severity,
  type WorkloadKind,
} from "./types";
import type { JobCheckOverride } from "@/lib/db/monitoring-queries";

/**
 * Request-body parsing shared by the job create and update routes, so the two
 * cannot drift on what a valid target selection is. Throws with a user-facing
 * message (the repo validates by hand — there is no zod).
 */

/**
 * Posture: one Holmes call covers the whole selection, so a very large job spreads
 * the model's attention thin and coverage gets unreliable. The form warns above the
 * soft limit; the hard cap is what protects the prompt.
 *
 * Deep: attention is not the constraint, because each workload gets its own call.
 * Time and money are. Every target is a full agentic investigation of several
 * minutes and real cost, run sequentially to stay inside LLM rate limits, so the
 * caps here are about a run that finishes at all rather than about prompt quality.
 */
export const TARGET_LIMITS: Record<
  MonitorDepth,
  { soft: number; hard: number }
> = {
  posture: { soft: 15, hard: 40 },
  deep: { soft: 4, hard: 10 },
};

export function parseDepth(raw: unknown, existing?: MonitorDepth): MonitorDepth {
  if (raw === undefined || raw === null || raw === "")
    return existing ?? "posture";
  if (
    typeof raw !== "string" ||
    !(MONITOR_DEPTHS as readonly string[]).includes(raw)
  )
    throw new Error(`depth must be one of: ${MONITOR_DEPTHS.join(", ")}`);
  return raw as MonitorDepth;
}

export function parseTargetList(
  raw: unknown,
  depth: MonitorDepth = "posture",
): AssessmentTarget[] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error("Select at least one Deployment or StatefulSet");
  const { hard } = TARGET_LIMITS[depth];
  if (raw.length > hard)
    throw new Error(
      depth === "deep"
        ? `A deep job can target at most ${hard} workloads — each one is a separate full investigation, taking minutes and costing real money, and they run one after another. Split it into several jobs or use a posture job for breadth.`
        : `A job can target at most ${hard} workloads — one assessment covers them all, and beyond that the results stop being trustworthy. Split it into several jobs.`,
    );

  const seen = new Set<string>();
  const targets: AssessmentTarget[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object")
      throw new Error("Each target must be an object");
    const t = item as Record<string, unknown>;
    const kind = typeof t.kind === "string" ? t.kind.toLowerCase() : "";
    const namespace = typeof t.namespace === "string" ? t.namespace.trim() : "";
    const name = typeof t.name === "string" ? t.name.trim() : "";
    if (!(WORKLOAD_KINDS as readonly string[]).includes(kind))
      throw new Error(`Target kind must be one of: ${WORKLOAD_KINDS.join(", ")}`);
    if (!namespace || !name)
      throw new Error("Each target needs a namespace and a name");
    const key = `${kind}/${namespace}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ kind: kind as WorkloadKind, namespace, name });
  }
  return targets;
}

/**
 * Per-job deviations from the catalogue. Only meaningful rows are kept — a check
 * left enabled with no severity override simply inherits, and storing that would
 * mean a job silently pinning today's catalogue instead of following it.
 */
export function parseOverrides(raw: unknown): JobCheckOverride[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("overrides must be an array");
  const seen = new Set<string>();
  const parsed: JobCheckOverride[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object")
      throw new Error("Each override must be an object");
    const o = item as Record<string, unknown>;
    const checkId = typeof o.checkId === "string" ? o.checkId.trim().toUpperCase() : "";
    if (!checkId) throw new Error("Each override needs a checkId");
    if (seen.has(checkId)) continue;
    seen.add(checkId);
    const severity = o.severityOverride;
    if (
      severity !== undefined &&
      severity !== null &&
      severity !== "" &&
      !(SEVERITIES as readonly string[]).includes(String(severity))
    )
      throw new Error(
        `severityOverride must be null or one of: ${SEVERITIES.join(", ")}`,
      );
    parsed.push({
      checkId,
      enabled: o.enabled !== false,
      severityOverride:
        severity === undefined || severity === null || severity === ""
          ? null
          : (severity as Severity),
    });
  }
  return parsed;
}
