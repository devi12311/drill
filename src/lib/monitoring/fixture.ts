import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { MonitorCheck } from "./catalogue";
import type { Playbook } from "./playbook";
import {
  parseAssessment,
  type AssessmentTarget,
  type MonitorCategory,
} from "./types";
import { buildAssessmentPrompt, type AssessmentOutcome } from "./assess";

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

/** Stable string hash, so fixture edits do not shuffle concerns or values. */
function stableHash(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

function stableIndex(checkId: string, length: number): number {
  return stableHash(checkId) % length;
}

/**
 * Synthetic measurements for a deep fixture run, one per playbook key.
 *
 * Two behaviours here are deliberately imperfect. Roughly one key in five is
 * omitted, and one source is reported unavailable — because the run page's job is
 * to show which measurements are MISSING and which sources were silent, and a
 * fixture that always returns a complete set would never exercise either surface.
 */
function fixtureObservations(
  playbook: Playbook,
  targets: readonly AssessmentTarget[],
) {
  const silentSource = playbook.observations.some((o) => o.source === "traces")
    ? "traces"
    : "node";
  const observations = targets.flatMap((target) =>
    playbook.observations
      .filter((spec) => stableHash(spec.key) % 5 !== 0)
      .filter((spec) => spec.source !== silentSource)
      .map((spec) => {
        const n = stableHash(`${target.name}/${spec.key}`) % 1000;
        return {
          target,
          key: spec.key,
          value: spec.unit ? String(n) : `fixture-${n}`,
          numeric: spec.unit ? n : null,
          unit: spec.unit,
          source: spec.source,
        };
      }),
  );
  return { observations, silentSource };
}

export async function fixtureAssessment(input: {
  category: MonitorCategory;
  model: string;
  targets: readonly AssessmentTarget[];
  /**
   * The job's effective catalogue — already narrowed to this job's kinds and
   * technologies by the caller, so it is used as given. Re-filtering it here would
   * silently drop the technology-scoped checks a deep run exists to ask.
   */
  checks: readonly MonitorCheck[];
  /** Present on a deep run: makes the fixture return measurements too. */
  playbook?: Playbook;
}): Promise<AssessmentOutcome> {
  const { category, model, targets, checks, playbook } = input;
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

  const applicable = new Set(checks.map((c) => c.id));
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

  const deep = playbook
    ? fixtureObservations(playbook, targets)
    : { observations: [], silentSource: null };

  const coverage = targets.map((target) => ({
    target,
    evaluated: [...applicable].filter((id) => !skippedIds.has(id)),
    skipped,
    sources_unavailable: deep.silentSource
      ? [
          {
            source: deep.silentSource,
            reason: "fixture: this source is deliberately reported as silent",
          },
        ]
      : [],
  }));

  const assessment = parseAssessment(
    JSON.stringify({
      findings,
      observations: deep.observations,
      coverage,
      summary: canned.summary,
    }),
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
      // Rendered even in fixture mode, so the run page's "what the agent was told"
      // panel is exercised without spending an investigation on it.
      prompts: [
        {
          target: targets.map((t) => t.name).join(", "),
          prompt: buildAssessmentPrompt({
            category,
            clusterName: "(fixture)",
            targets,
            checks,
            playbook,
          }),
        },
      ],
      raw: {
        analysis: "(fixture assessment)",
        tool_calls: [],
        follow_up_actions: null,
        pending_approvals: null,
      },
    },
  };
}
