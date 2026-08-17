import "server-only";
import { parseSse } from "@/lib/holmes/stream";
import type { HolmesChatResponse, ToolCall } from "@/lib/holmes/types";
import {
  REQUIREMENT_LABEL,
  SECURITY_SCOPE_CAVEAT,
  type CheckRequirement,
  type MonitorCheck,
} from "./catalogue";
import { renderPlaybook, type Playbook } from "./playbook";
import {
  OBSERVATION_SOURCES,
  SEVERITIES,
  WORKLOAD_KINDS,
  parseAssessment,
  targetLabel,
  type Assessment,
  type AssessmentTarget,
  type MonitorCategory,
  type MonitorDepth,
} from "./types";

/**
 * The Holmes call, in two depths.
 *
 * A POSTURE assessment is one non-streaming call covering every workload the job
 * selected (decision 46: cheaper, and one prompt to tune, at the cost of looser
 * attribution — which is why the schema forces a `target` on every finding and a
 * `coverage` entry per workload).
 *
 * A DEEP assessment is one call per workload, carrying that technology's playbook
 * and demanding measured facts back. Three things differ, and each is deliberate:
 *
 * 1. The playbook is in the prompt, so the agent is told where the data lives.
 *    Without that it has to guess, and guessing costs tool calls it is otherwise
 *    incentivised to save.
 * 2. `observations` is a required section whose keys are enumerated. Those fields
 *    cannot be filled by reading a manifest, which is what actually forces a
 *    multi-source investigation — asking nicely in prose does not.
 * 3. Planning stays ON. The posture path disables TodoWrite, which is upstream's
 *    `--fast-mode`, and that prompt section is precisely the self-continuation loop
 *    ("if gaps remain, keep investigating instead of answering"). Sound economy for
 *    a config lint; wrong for a forty-question investigation across four sources.
 *
 * Modelled on askHolmes() in lib/artifacts/distill.ts: `stream: false` +
 * `response_format`, and the structured result arrives as a JSON STRING inside
 * `analysis`.
 */

/**
 * How long to wait for one assessment, by depth.
 *
 * These are OUR deadlines, not upstream's — worth recording, because the original
 * flat 300s was justified with "upstream's own cap is 300s" and that is false.
 * Upstream's `LLM_REQUEST_TIMEOUT` is 600s and applies to a single LLM call; an
 * agentic investigation is many such calls plus tool execution and has no upstream
 * wall-clock bound at all. The only real ceiling is `max_steps` (default 100).
 *
 * Measured on this cluster, same single Postgres StatefulSet: the generic rubric
 * finished in 187s over 30 tool calls, and the same target WITH its playbook ran
 * past 300s — the method made the agent do the work, which is the point.
 *
 * Deep gets 20 minutes PER WORKLOAD, which with the 10-target cap and the single
 * malformed-output retry is what sets `STALE_RUN_MS.deepMs` in runner.ts — keep the
 * two in step.
 */
const ASSESS_TIMEOUT_MS: Record<MonitorDepth, number> = {
  posture: 300_000,
  deep: 1_200_000,
};

/** What lands in `monitoring_runs.raw_response`; conversation history is both enormous and server-only. */
export type StoredHolmesResponse = Omit<
  HolmesChatResponse,
  "conversation_history"
>;

export interface AssessmentRunMeta {
  model: string;
  costUsd: number | null;
  totalTokens: number | null;
  durationMs: number;
  toolCallsTotal: number;
  toolCallsFailed: number;
  /** One response for a posture run; one per workload for a deep run. */
  raw: StoredHolmesResponse | StoredHolmesResponse[];
  /** What the agent was actually told, kept so a run can be audited later. */
  prompts: { target: string; prompt: string }[];
}

export interface AssessmentOutcome {
  assessment: Assessment;
  meta: AssessmentRunMeta;
}

/**
 * Strict JSON schema derived FROM THE CATALOGUE, so an invented check ID is a
 * schema violation rather than a bad row. strict mode requires every property
 * in `required` and `additionalProperties: false` at every level.
 *
 * `observationKeys` (deep runs only) does the same job for measurements: the keys
 * are enumerated from the playbook, so a made-up metric name is rejected by the
 * schema and the keys stay stable enough to trend across runs.
 */
export function buildResponseFormat(
  checks: readonly MonitorCheck[],
  observationKeys: readonly string[] = [],
) {
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

  const deep = observationKeys.length > 0;
  const observations = {
    type: "array",
    description:
      "The facts you MEASURED, one entry per key you could measure. Omit keys you could not measure; never estimate.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["target", "key", "value", "numeric", "unit", "source"],
      properties: {
        target,
        key: { type: "string", enum: [...observationKeys] },
        value: {
          type: "string",
          description: "The measured value as read, e.g. \"128MB\", \"false\", \"3.2\"",
        },
        numeric: {
          type: ["number", "null"],
          description: "The same value as a number when it is one, otherwise null",
        },
        unit: { type: "string" },
        source: {
          type: "string",
          enum: [...OBSERVATION_SOURCES],
          description: "Where you actually got this value from",
        },
      },
    },
  } as const;

  const sourcesUnavailable = {
    type: "array",
    description:
      "Data sources you tried and got nothing usable from, with why. This is how a degraded assessment stays honest.",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["source", "reason"],
      properties: {
        source: { type: "string", enum: [...OBSERVATION_SOURCES] },
        reason: { type: "string" },
      },
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
        required: deep
          ? ["findings", "observations", "coverage", "summary"]
          : ["findings", "coverage", "summary"],
        properties: {
          ...(deep ? { observations } : {}),
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
              required: deep
                ? ["target", "evaluated", "skipped", "sources_unavailable"]
                : ["target", "evaluated", "skipped"],
              properties: {
                ...(deep ? { sources_unavailable: sourcesUnavailable } : {}),
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
  /** Present on deep runs: the method for the technology being assessed. */
  playbook?: Playbook;
}): string {
  const { category, clusterName, targets, checks, playbook } = input;
  // A deep run is always one workload, so the playbook renders against it.
  const method =
    playbook && targets.length === 1
      ? `\n${renderPlaybook(playbook, targets[0])}\n`
      : "";
  const deepRules = playbook
    ? `
- Follow the investigation method above. It tells you where this technology's data actually lives; do not fall back to reading only the Kubernetes manifest.
- "observations" is mandatory and is where your measurements go. Every entry needs the source you actually got it from. A value you did not measure must be omitted, never estimated or inferred from what is typical for this software.
- If a data source is unreachable, put it in that target's "sources_unavailable" with the reason. An assessment built on two sources out of five is useful; one that hides which three were missing is not.
- Checks whose evidence you could not obtain go in "skipped". Never pass a check because nothing looked wrong in the data you did not read.`
    : "";

  return `${CATEGORY_FRAMING[category]}

You are running unattended, on a schedule, in cluster "${clusterName}". Your output is stored and compared against previous runs, so it must be evidence-based and use the exact check IDs below.

TARGET WORKLOADS — assess every one, and nothing else:
${targets
  .map((t, i) => `${i + 1}. ${t.kind} "${t.name}" in namespace "${t.namespace}"`)
  .join("\n")}
${method}
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
- If a target workload does not exist, put every check for it in "skipped" with reason "workload not found".${deepRules}`;
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

/**
 * Ask Holmes, over SSE.
 *
 * **Streaming is not for progress here — it is what makes a long investigation
 * possible at all.** With `stream: false` Holmes holds the socket completely silent
 * for the entire investigation: no headers, no bytes, until it is finished. Node's
 * HTTP client (undici) gives up on a connection that has sent no response headers
 * after 300s, so every deep run died at almost exactly five minutes with an opaque
 * `fetch failed` while Holmes was still working perfectly — and raising our own
 * AbortSignal did nothing, because that 300s belongs to the transport, not to us.
 * Any proxy between here and Holmes would impose its own idle timeout too.
 *
 * Streaming keeps the connection continuously active, which removes the whole class
 * of problem rather than raising one number. It is also how the chat path has always
 * talked to Holmes, which is why that path never hit this.
 *
 * `tool_calls` is accumulated from the stream because `ai_answer_end` does not carry
 * it — the same reason `liveStream` accumulates it in lib/holmes/stream.ts.
 */
async function askHolmes(
  target: { url: string; apiKey: string },
  model: string,
  ask: string,
  responseFormat: unknown,
  depth: MonitorDepth,
): Promise<HolmesChatResponse> {
  const base = target.url.replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${target.apiKey}`,
    },
    body: JSON.stringify({
      ask,
      model,
      stream: true,
      response_format: responseFormat,
      // Posture runs use upstream's "fast mode": skipping the TodoWrite planning
      // phase is pure overhead for a single-shot config lint. Deep runs must NOT,
      // because that same prompt section is the loop that makes the agent keep
      // going when its own investigation is still incomplete — omitting
      // behavior_controls leaves every prompt component enabled, which is the
      // default.
      ...(depth === "posture"
        ? {
            behavior_controls: {
              todowrite_instructions: false,
              todowrite_reminder: false,
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(ASSESS_TIMEOUT_MS[depth]),
    cache: "no-store",
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    throw new Error(`Holmes API ${res.status}: ${body.slice(0, 300)}`);
  }

  const toolCalls: ToolCall[] = [];
  for await (const { event, data } of parseSse(res.body)) {
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data);
    } catch {
      continue;
    }
    if (event === "tool_calling_result") {
      toolCalls.push({
        tool_call_id: String(payload.tool_call_id ?? ""),
        tool_name: String(payload.name ?? payload.tool_name ?? "tool"),
        description: String(payload.description ?? ""),
        result: (payload.result ?? {
          status: "success",
          error: null,
          data: null,
        }) as ToolCall["result"],
      });
    } else if (event === "error") {
      throw new Error(
        `Holmes stream error: ${String(payload.message ?? payload.error ?? "unknown")}`,
      );
    } else if (event === "ai_answer_end") {
      const analysis = payload.analysis;
      if (typeof analysis !== "string")
        throw new Error("Holmes response has no analysis");
      return {
        analysis,
        conversation_history: [],
        tool_calls: toolCalls,
        follow_up_actions:
          (payload.follow_up_actions as HolmesChatResponse["follow_up_actions"]) ??
          null,
        pending_approvals: payload.pending_approvals ?? null,
        metadata: payload.metadata as HolmesChatResponse["metadata"],
      };
    }
  }
  // Reaching here means the stream closed without a terminal event — a dropped
  // connection rather than a refusal, and worth naming as such.
  throw new Error(
    `Holmes stream ended after ${toolCalls.length} tool calls without a final answer`,
  );
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
  depth?: MonitorDepth;
  /** Deep runs over a profiled technology: that technology's method. */
  playbook?: Playbook;
}): Promise<AssessmentOutcome> {
  const { cluster, category, model, targets, checks, playbook } = input;
  const depth = input.depth ?? "posture";
  if (targets.length === 0) throw new Error("The job has no target workloads");
  if (checks.length === 0)
    throw new Error(
      "Every check for this job is disabled — nothing would be assessed",
    );

  const allowedChecks = new Set(checks.map((c) => c.id));
  // Only a deep run against a profiled technology asks for measurements; without a
  // playbook there are no keys to enumerate, and the schema stays as it was.
  const observationKeys =
    depth === "deep" && playbook
      ? playbook.observations.map((o) => o.key)
      : [];
  const responseFormat = buildResponseFormat(checks, observationKeys);
  const ask = buildAssessmentPrompt({
    category,
    clusterName: cluster.name,
    targets,
    checks,
    playbook: depth === "deep" ? playbook : undefined,
  });
  const agent = { url: cluster.holmesUrl, apiKey: cluster.holmesApiKey };

  const startedAt = Date.now();
  let response = await askHolmes(agent, model, ask, responseFormat, depth);
  let assessment: Assessment;
  try {
    assessment = parseAssessment(response.analysis, allowedChecks, targets);
  } catch {
    response = await askHolmes(
      agent,
      model,
      `${ask}\n\nIMPORTANT: Return ONLY the JSON object matching the schema — no prose, no code fences.`,
      responseFormat,
      depth,
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
      prompts: [{ target: describeTargets(targets), prompt: ask }],
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

/**
 * Fold a deep run's per-workload outcomes into the single shape the rest of the
 * pipeline already speaks, so reconciliation and persistence stay unchanged.
 *
 * Merging rather than reconciling per call is deliberate: reconciliation needs the
 * union of everything this run evaluated in order to decide what is absent, and it
 * must commit once, in one transaction, with the run's status. Reconciling N times
 * would leave a half-updated history if the fifth workload's call failed.
 *
 * Costs sum because they were all really spent. `durationMs` also sums, because the
 * calls run sequentially — LLM rate limits, same reason the queue drains serially.
 */
export function mergeOutcomes(
  outcomes: readonly AssessmentOutcome[],
): AssessmentOutcome {
  if (outcomes.length === 0)
    throw new Error("No assessment outcomes to merge");

  const sum = (pick: (m: AssessmentRunMeta) => number | null) =>
    outcomes.reduce((total, o) => total + (pick(o.meta) ?? 0), 0);
  // Distinguish "nothing was reported" from "the total was zero": if no call
  // returned a cost, the run's cost is unknown rather than free.
  const sumOrNull = (pick: (m: AssessmentRunMeta) => number | null) =>
    outcomes.some((o) => pick(o.meta) !== null) ? sum(pick) : null;

  return {
    assessment: {
      findings: outcomes.flatMap((o) => o.assessment.findings),
      observations: outcomes.flatMap((o) => o.assessment.observations),
      coverage: {
        targets: outcomes.flatMap((o) => o.assessment.coverage.targets),
        summary: outcomes
          .map((o) => o.assessment.coverage.summary)
          .filter(Boolean)
          .join("\n\n"),
      },
      rejected: outcomes.flatMap((o) => o.assessment.rejected),
    },
    meta: {
      model: outcomes[0].meta.model,
      costUsd: sumOrNull((m) => m.costUsd),
      totalTokens: sumOrNull((m) => m.totalTokens),
      durationMs: sum((m) => m.durationMs),
      toolCallsTotal: sum((m) => m.toolCallsTotal),
      toolCallsFailed: sum((m) => m.toolCallsFailed),
      // One entry per call. The run page renders a list, and keeping every
      // response is what makes a per-workload run auditable after the fact.
      // flatMap, so merging an already-merged outcome stays flat.
      raw: outcomes.flatMap((o) => o.meta.raw),
      prompts: outcomes.flatMap((o) => o.meta.prompts),
    },
  };
}
