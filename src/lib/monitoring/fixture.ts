import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { applicableChecks, type MonitorCheck } from "./catalogue";
import {
  parseAssessment,
  type AssessmentTarget,
  type MonitorCategory,
  type WorkloadKind,
} from "./types";
import type { AssessmentOutcome } from "./assess";

/**
 * Fixture-mode assessment: HOLMES_FIXTURE=1 short-circuits the runner here so
 * the monitoring UI and the reconciliation logic can be exercised without
 * spending ~$0.50 per investigation (docs/DECISIONS.md).
 *
 * The fixture stores findings WITHOUT targets, because it cannot know which
 * workloads a job selected. They are dealt round-robin across the job's real
 * targets and the result goes through the REAL validator — so this path
 * exercises parsing and rejection too, not just the happy shape.
 */

interface FixtureFinding {
  check_id: string;
  /** Optional override; normally the generator assigns one of the job's targets. */
  target?: { kind: string; namespace: string; name: string };
  scope: string;
  effective_severity: string;
  severity_rationale: string;
  title: string;
  rationale: string;
  remediation: string;
  evidence: { label: string; value: string }[];
}

interface FixtureCategory {
  summary: string;
  findings: FixtureFinding[];
  skipped: { check_id: string; reason: string }[];
}

/** Stable check-ID → target index, so fixture edits do not shuffle concerns. */
function stableIndex(checkId: string, length: number): number {
  let hash = 0;
  for (const char of checkId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % length;
}

export async function fixtureAssessment(input: {
  category: MonitorCategory;
  model: string;
  targets: readonly AssessmentTarget[];
  /** The job's effective catalogue, so fixture runs respect disabled checks. */
  checks: readonly MonitorCheck[];
}): Promise<AssessmentOutcome> {
  const { category, model, targets, checks } = input;
  if (targets.length === 0) throw new Error("The job has no target workloads");

  const file = path.join(
    process.cwd(),
    "fixtures",
    "monitoring-assessment.json",
  );
  const raw = JSON.parse(await readFile(file, "utf8")) as Record<
    string,
    FixtureCategory
  >;
  const canned = raw[category];
  if (!canned)
    throw new Error(`Fixture has no "${category}" section — see ${file}`);

  const kinds = [...new Set(targets.map((t) => t.kind))] as WorkloadKind[];
  const applicable = new Set(
    applicableChecks(checks, category, kinds).map((c) => c.id),
  );
  const skipped = canned.skipped.filter((s) => applicable.has(s.check_id));
  const skippedIds = new Set(skipped.map((s) => s.check_id));

  // Spread findings across the job's targets so multi-workload jobs look real.
  // Keyed off the check ID rather than array position, so adding or removing a
  // finding from the fixture does NOT re-assign the others — otherwise editing
  // the file to test auto-resolution would churn every unrelated concern too.
  //
  // Note what is NOT filtered here: a check ID the catalogue does not know is
  // passed straight through, and an explicit `target` is honoured. The fixture
  // must not be smarter than the model it stands in for, or the validator's
  // rejection path would never be exercised.
  const known = new Set(checks.map((c) => c.id));
  const findings = canned.findings
    .filter(
      (f) =>
        !skippedIds.has(f.check_id) &&
        (!known.has(f.check_id) || applicable.has(f.check_id)),
    )
    .map((f) => ({
      ...f,
      target: f.target ?? targets[stableIndex(f.check_id, targets.length)],
    }));

  const coverage = targets.map((target) => ({
    target,
    evaluated: [...applicable].filter((id) => !skippedIds.has(id)),
    skipped,
  }));

  const assessment = parseAssessment(
    JSON.stringify({ findings, coverage, summary: canned.summary }),
    applicable,
    targets,
  );

  return {
    assessment,
    meta: {
      model: `${model} (fixture)`,
      costUsd: 0,
      totalTokens: 0,
      durationMs: 1200,
      toolCallsTotal: 0,
      toolCallsFailed: 0,
      raw: {
        analysis: "(fixture assessment)",
        tool_calls: [],
        follow_up_actions: null,
        pending_approvals: null,
      },
    },
  };
}
