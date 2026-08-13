import "server-only";
import type { HolmesChatResponse } from "@/lib/holmes/types";
import {
  REQUIREMENT_LABEL,
  SECURITY_SCOPE_CAVEAT,
  type CheckRequirement,
  type MonitorCheck,
} from "./catalogue";
import {
  SEVERITIES,
  WORKLOAD_KINDS,
  parseAssessment,
  targetLabel,
  type Assessment,
  type AssessmentTarget,
  type MonitorCategory,
} from "./types";

/**
 * One assessment = ONE non-streaming Holmes call covering every workload the
 * job selected (decided with Devis: cheaper and one prompt to tune, at the cost
 * of looser attribution — which is why the schema forces a `target` on every
 * finding and a `coverage` entry per workload).
 *
 * Modelled on askHolmes() in lib/artifacts/distill.ts: `stream: false` +
 * `response_format`, and the structured result arrives as a JSON STRING inside
 * `analysis`.
 */

/** Investigations run tens of seconds to minutes; upstream's own cap is 300s. */
const ASSESS_TIMEOUT_MS = 300_000;

export interface AssessmentRunMeta {
  model: string;
  costUsd: number | null;
  totalTokens: number | null;
  durationMs: number;
  toolCallsTotal: number;
  toolCallsFailed: number;
  raw: Omit<HolmesChatResponse, "conversation_history">;
}

export interface AssessmentOutcome {
  assessment: Assessment;
  meta: AssessmentRunMeta;
}

/**
 * Strict JSON schema derived FROM THE CATALOGUE, so an invented check ID is a
 * schema violation rather than a bad row. strict mode requires every property
 * in `required` and `additionalProperties: false` at every level.
 */
export function buildResponseFormat(checks: readonly MonitorCheck[]) {
  const checkIds = checks.map((c) => c.id);
  const target = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "namespace", "name"],
    properties: {
      kind: { type: "string", enum: [...WORKLOAD_KINDS] },
      namespace: { type: "string" },
      name: { type: "string" },
    },
  } as const;

  return {
    type: "json_schema",
    json_schema: {
      name: "workload_assessment",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["findings", "coverage", "summary"],
        properties: {
          findings: {
            type: "array",
            description:
              "One entry per FAILING check per target. Passing checks are omitted.",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "check_id",
                "target",
                "scope",
                "effective_severity",
                "severity_rationale",
                "title",
                "rationale",
                "remediation",
                "evidence",
              ],
              properties: {
                check_id: { type: "string", enum: checkIds },
                target,
                scope: {
                  type: "string",
                  description:
                    "The container / volume / role the failure is in; empty string when it applies to the whole workload",
                },
                effective_severity: { type: "string", enum: [...SEVERITIES] },
                severity_rationale: {
                  type: "string",
                  description:
                    "Why this differs from the check's base severity; empty string if unchanged",
                },
                title: {
                  type: "string",
                  description:
                    "One specific line naming the workload and the problem, at most 120 characters",
                },
                rationale: {
                  type: "string",
                  description:
                    "What was observed and why it matters here (markdown, 1-3 sentences)",
                },
                remediation: {
                  type: "string",
                  description:
                    "The concrete change for THIS workload — field path and value, not general advice",
                },
                evidence: {
                  type: "array",
                  description: "Observed values that prove the finding",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["label", "value"],
                    properties: {
                      label: { type: "string" },
                      value: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          coverage: {
            type: "array",
            description: "One entry per target — mandatory, even when nothing failed.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["target", "evaluated", "skipped"],
              properties: {
                target,
                evaluated: {
                  type: "array",
                  description: "Check IDs you actually reached a verdict on",
                  items: { type: "string", enum: checkIds },
                },
                skipped: {
                  type: "array",
                  description:
                    "Check IDs you could NOT judge, with why (missing telemetry, RBAC denied, resource absent)",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["check_id", "reason"],
                    properties: {
                      check_id: { type: "string", enum: checkIds },
                      reason: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          summary: {
            type: "string",
            description:
              "2-4 sentences on the overall posture of these workloads (markdown)",
          },
        },
      },
    },
  } as const;
}

function renderCheck(check: MonitorCheck): string {
  const lines = [
    `[${check.id}] ${check.title} — base severity: ${check.baseSeverity}`,
    `  Determine: ${check.question}`,
    `  Evidence to cite: ${check.evidence}`,
  ];
  if (check.requires)
    lines.push(
      `  Needs: ${REQUIREMENT_LABEL[check.requires as CheckRequirement] ?? check.requires} — if unavailable, put this check in "skipped", do NOT pass it.`,
    );
  return lines.join("\n");
}

const CATEGORY_FRAMING: Record<MonitorCategory, string> = {
  security: `You are performing a scheduled SECURITY POSTURE assessment. Scope: ${SECURITY_SCOPE_CAVEAT}`,
  performance:
    "You are performing a scheduled PERFORMANCE AND RELIABILITY assessment: how these workloads are actually behaving and whether they are configured to stay healthy under load, disruption and failure.",
};

export function buildAssessmentPrompt(input: {
  category: MonitorCategory;
  clusterName: string;
  targets: readonly AssessmentTarget[];
  checks: readonly MonitorCheck[];
}): string {
  const { category, clusterName, targets, checks } = input;
  return `${CATEGORY_FRAMING[category]}

You are running unattended, on a schedule, in cluster "${clusterName}". Your output is stored and compared against previous runs, so it must be evidence-based and use the exact check IDs below.

TARGET WORKLOADS — assess every one, and nothing else:
${targets
  .map((t, i) => `${i + 1}. ${t.kind} "${t.name}" in namespace "${t.namespace}"`)
  .join("\n")}

CHECKS — answer exactly these questions, for each target:

${checks.map(renderCheck).join("\n\n")}

RULES
- Investigate with your tools. Never infer a verdict from a workload's name or from what is "typical" — read the live spec, status, events and metrics.
- "findings" contains one entry per FAILING check per target. Omit passing checks entirely.
- "coverage" MUST contain one entry per target listing the check IDs you evaluated and the ones you skipped with a reason. A check you could not judge — missing metrics, RBAC denied, resource absent — belongs in "skipped". Never report it as evaluated, and never let it look like a pass.
- Use ONLY the check IDs listed above, exactly as written. Do not invent checks; if you notice something important that no check covers, mention it in "summary" instead.
- Do not report the same check twice for the same target and scope. When several containers of one workload fail the same check, use "scope" to distinguish them.
- effective_severity starts at the check's base severity. Adjust it only when this cluster's context justifies it (production exposure, replica count, blast radius) and explain the change in severity_rationale; leave severity_rationale empty when you keep the base.
- evidence must be observed values — numbers, field paths, event messages, PromQL results — not a restatement of the question.
- remediation must be the specific change for that workload: the field to set and the value to set it to.
- Never output Secret values, tokens, passwords or certificate material. Reference secrets by name only.
- If a target workload does not exist, put every check for it in "skipped" with reason "workload not found".`;
}

function countToolCalls(response: HolmesChatResponse) {
  const calls = Array.isArray(response.tool_calls) ? response.tool_calls : [];
  return {
    toolCallsTotal: calls.length,
    // Holmes hands the model an empty result for a failed tool and carries on,
    // so a clean-looking assessment can rest on missing data. Surfaced per run.
    toolCallsFailed: calls.filter((c) => c.result?.status === "error").length,
  };
}

async function askHolmes(
  target: { url: string; apiKey: string },
  model: string,
  ask: string,
  responseFormat: unknown,
): Promise<HolmesChatResponse> {
  const base = target.url.replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify({
      ask,
      model,
      stream: false,
      response_format: responseFormat,
      // Upstream's "fast mode": skip the TodoWrite planning phase, which is
      // pure overhead for a single-shot structured assessment.
      behavior_controls: {
        todowrite_instructions: false,
        todowrite_reminder: false,
      },
    }),
    signal: AbortSignal.timeout(ASSESS_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Holmes API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as HolmesChatResponse;
  if (typeof data.analysis !== "string")
    throw new Error("Holmes response has no analysis");
  return data;
}

/**
 * Assess one job's workloads. One retry when the structured output comes back
 * malformed (same convention as distillArtifact).
 */
export async function runAssessment(input: {
  cluster: { name: string; holmesUrl: string; holmesApiKey: string };
  category: MonitorCategory;
  model: string;
  targets: readonly AssessmentTarget[];
  /** The job's effective catalogue — resolved by the caller (lib/monitoring/checks). */
  checks: readonly MonitorCheck[];
}): Promise<AssessmentOutcome> {
  const { cluster, category, model, targets, checks } = input;
  if (targets.length === 0) throw new Error("The job has no target workloads");
  if (checks.length === 0)
    throw new Error(
      "Every check for this job is disabled — nothing would be assessed",
    );

  const allowedChecks = new Set(checks.map((c) => c.id));
  const responseFormat = buildResponseFormat(checks);
  const ask = buildAssessmentPrompt({
    category,
    clusterName: cluster.name,
    targets,
    checks,
  });
  const agent = { url: cluster.holmesUrl, apiKey: cluster.holmesApiKey };

  const startedAt = Date.now();
  let response = await askHolmes(agent, model, ask, responseFormat);
  let assessment: Assessment;
  try {
    assessment = parseAssessment(response.analysis, allowedChecks, targets);
  } catch {
    response = await askHolmes(
      agent,
      model,
      `${ask}\n\nIMPORTANT: Return ONLY the JSON object matching the schema — no prose, no code fences.`,
      responseFormat,
    );
    assessment = parseAssessment(response.analysis, allowedChecks, targets);
  }

  return {
    assessment,
    meta: {
      model,
      costUsd: response.metadata?.costs?.total_cost ?? null,
      totalTokens:
        response.metadata?.usage?.total_tokens ??
        response.metadata?.costs?.total_tokens ??
        null,
      durationMs: Date.now() - startedAt,
      ...countToolCalls(response),
      // Built field by field rather than spread-minus-history: this is what
      // lands in `monitoring_runs.raw_response`, and conversation_history is
      // both enormous and server-only.
      raw: {
        analysis: response.analysis,
        tool_calls: response.tool_calls,
        follow_up_actions: response.follow_up_actions,
        pending_approvals: response.pending_approvals,
        metadata: response.metadata,
      },
    },
  };
}

/** Human-readable target list for logs and run summaries. */
export function describeTargets(targets: readonly AssessmentTarget[]): string {
  return targets.map(targetLabel).join(", ");
}
