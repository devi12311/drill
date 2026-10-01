import "server-only";
import { completeHolmesChat } from "@/lib/holmes/sse";
import type { HolmesChatResponse, ToolCall } from "@/lib/holmes/types";
import type { MonitorCheck } from "./catalogue";
import { REQUIREMENT_LABEL } from "./ui";
import { renderPlaybook, type Playbook } from "./playbook";
import {
  OBSERVATION_SOURCES,
  SECURITY_SCOPE_CAVEAT,
  SEVERITIES,
  TARGET_KINDS,
  isClusterTarget,
  parseAssessment,
  targetLabel,
  type Assessment,
  type AssessmentTarget,
  type CheckRequirement,
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
 * Every call streams (lib/holmes/sse.ts), and the structured result arrives as a
 * JSON STRING inside `analysis`. How the schema is applied is in runAssessment.
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
 * Deep gets 20 minutes PER WORKLOAD. Nothing else has to be kept in step with it:
 * the reaper judges a run by its worker's heartbeat, not by how long it has taken.
 */
const ASSESS_TIMEOUT_MS: Record<MonitorDepth, number> = {
  posture: 300_000,
  deep: 1_200_000,
};

/**
 * The cluster's own deep run gets longer than a workload's.
 *
 * It is the widest investigation the system asks for — one method covering the
 * control plane, every node, scheduling, DNS, the CNI dataplane, storage and a
 * clusterwide workload rollup, with ~50 measurements to bring back. At the 20
 * minutes a workload gets, the failure mode is a timeout mid-investigation, which
 * costs the whole run and teaches nothing. A hung call is still bounded by this
 * deadline, and a dead worker by its heartbeat.
 */
const CLUSTER_ASSESS_TIMEOUT_MS = 2_700_000;

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
      kind: { type: "string", enum: [...TARGET_KINDS] },
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

/**
 * The same category, aimed at the cluster instead of at workloads. Kept separate
 * rather than made vague enough to cover both: the framing is the sentence that
 * decides where the agent looks first, and "how these workloads are behaving" sends
 * it to the wrong layer entirely when the subject is the platform underneath them.
 */
const CLUSTER_CATEGORY_FRAMING: Record<MonitorCategory, string> = {
  security: `You are performing a scheduled SECURITY POSTURE assessment of a Kubernetes cluster itself. Scope: ${SECURITY_SCOPE_CAVEAT}`,
  performance:
    "You are performing a scheduled PERFORMANCE AND RELIABILITY assessment of a Kubernetes cluster itself: whether the platform is fast, has capacity, can place and keep work running, and can survive losing a node — not whether any single application is healthy.",
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
  // A deep run is always one target, so the playbook renders against it.
  const method =
    playbook && targets.length === 1
      ? `\n${renderPlaybook(playbook, targets[0])}\n`
      : "";
  const cluster = targets.length === 1 && isClusterTarget(targets[0]);
  const deepRules = playbook
    ? `
- Follow the investigation method above. It tells you where this technology's data actually lives; do not fall back to reading only the Kubernetes manifest.
- "observations" is mandatory and is where your measurements go. Every entry needs the source you actually got it from. A value you did not measure must be omitted, never estimated or inferred from what is typical for this software.
- If a data source is unreachable, put it in that target's "sources_unavailable" with the reason. An assessment built on two sources out of five is useful; one that hides which three were missing is not.
- Checks whose evidence you could not obtain go in "skipped". Never pass a check because nothing looked wrong in the data you did not read.`
    : "";

  return `${(cluster ? CLUSTER_CATEGORY_FRAMING : CATEGORY_FRAMING)[category]}

You are running unattended, on a schedule, in cluster "${clusterName}". Your output is stored and compared against previous runs, so it must be evidence-based and use the exact check IDs below.

${
  cluster
    ? `TARGET — the CLUSTER ITSELF, registered here as "${clusterName}": its control plane and etcd, its nodes, scheduling, networking and DNS, its storage, and the health of its workloads in aggregate. Not any one workload.`
    : `TARGET WORKLOADS — assess every one, and nothing else:
${targets
  .map((t, i) => `${i + 1}. ${t.kind} "${t.name}" in namespace "${t.namespace}"`)
  .join("\n")}`
}
${method}
CHECKS — answer exactly these questions, for each target:

${checks.map(renderCheck).join("\n\n")}

RULES
- Investigate with your tools. Never infer a verdict from a workload's name or from what is "typical" — read the live spec, status, events and metrics.
- "findings" contains one entry per FAILING check per target. Omit passing checks entirely.
- "coverage" MUST contain one entry per target listing the check IDs you evaluated and the ones you skipped with a reason. A check you could not judge — missing metrics, RBAC denied, resource absent — belongs in "skipped". Never report it as evaluated, and never let it look like a pass.
- The reverse matters just as much: "skipped" is ONLY for a check you could not judge. A check you DID judge and found nothing wrong with is a pass — list it in "evaluated", omit it from "findings", and do not put it in "skipped" at all. A skip reason that describes a healthy result ("the numbers were fine", "no failure to report", "nothing was wrong", "not proven") turns a clean answer into an unknown, and an unknown can never close a problem that was open before. Never list the same check in both "evaluated" and "skipped". If you judged a check on partial evidence, judge it and say which evidence was missing in the finding — that is a verdict, not a skip.
- Use ONLY the check IDs listed above, exactly as written. Do not invent checks; if you notice something important that no check covers, mention it in "summary" instead.
- Do not report the same check twice for the same target and scope. When several containers of one workload fail the same check, use "scope" to distinguish them.${
    cluster
      ? `
- "scope" is what gives a cluster finding its address: put the node, namespace, component, workload or object it is about in it. A finding about one node and a finding about another are two separate concerns with separate evidence — report them separately. Leave "scope" empty only for something genuinely clusterwide.
- Every "target" must be exactly {"kind":"cluster","namespace":"-","name":"cluster"}. Never put a node or namespace name there; that is what "scope" is for.
- An aggregate number is not a finding on its own. Whenever you report a clusterwide figure, name the nodes, namespaces or workloads that dominate it and their share of it.`
      : ""
  }
- effective_severity starts at the check's base severity. Adjust it only when this cluster's context justifies it (production exposure, replica count, blast radius) and explain the change in severity_rationale; leave severity_rationale empty when you keep the base.
- evidence must be observed values — numbers, field paths, event messages, PromQL results — not a restatement of the question.
- remediation must be the specific change to make${
    cluster
      ? ", named down to the object: the node, component, manifest field or setting, and the value to set it to. Never general advice about Kubernetes."
      : " for that workload: the field to set and the value to set it to."
  }
- Never output Secret values, tokens, passwords or certificate material. Reference secrets by name only.
${
    cluster
      ? '- If a cluster component you were told to examine does not exist here (no NodeLocal DNSCache, no cluster-autoscaler, no ResourceQuotas anywhere), that is an observation about this cluster, not a missing target. Say so in the finding or the summary; do not skip the check as "not found".'
      : '- If a target workload does not exist, put every check for it in "skipped" with reason "workload not found".'
  }${deepRules}`;
}

/**
 * Posture runs use upstream's "fast mode": skipping the TodoWrite planning phase is
 * pure overhead for a single-shot config lint. Deep runs must NOT, because that
 * same prompt section is the loop that makes the agent keep going when its own
 * investigation is still incomplete — omitting behavior_controls leaves every
 * prompt component enabled, which is the default. The format phase never plans.
 */
const FAST_MODE = {
  behavior_controls: {
    todowrite_instructions: false,
    todowrite_reminder: false,
  },
} as const;

/**
 * The format phase is one LLM turn over evidence already gathered, so it is short.
 */
const FORMAT_TIMEOUT_MS = 5 * 60 * 1000;
const FORMAT_ATTEMPTS = 2;

const FORMAT_ASK = `Your investigation above is complete. Do not call any more tools.

Return the final assessment now, as the JSON object the response schema requires, built ONLY from the evidence already gathered above. Every rule from the original instructions still applies: the exact check IDs, one coverage entry per target, "skipped" only for checks you could not judge, and measurements only where you actually measured them.`;

/**
 * Appended to the investigation prompt: the schema as text, so the agent knows the
 * exact shape it is working towards without the schema being ENFORCED on every turn
 * (see runAssessment for why enforcement is deferred).
 */
function outputContract(responseFormat: ReturnType<typeof buildResponseFormat>) {
  return `

OUTPUT
When your investigation is complete, reply with ONLY one JSON object matching this JSON Schema — no prose, no code fences:
${JSON.stringify(responseFormat.json_schema.schema)}`;
}

function stored(response: HolmesChatResponse): StoredHolmesResponse {
  // Built field by field rather than spread-minus-history: this is what lands in
  // `monitoring_runs.raw_response`, and conversation_history is both enormous and
  // server-only.
  return {
    analysis: response.analysis,
    tool_calls: response.tool_calls,
    follow_up_actions: response.follow_up_actions,
    pending_approvals: response.pending_approvals,
    metadata: response.metadata,
  };
}

/**
 * What one assessment spent and did, from every call that RETURNED plus every tool
 * call seen on the wire — including those of a call that then dropped, which is
 * exactly the case a failed run needs explained.
 */
function runMeta(input: {
  model: string;
  startedAt: number;
  prompts: AssessmentRunMeta["prompts"];
  responses: readonly HolmesChatResponse[];
  toolCalls: readonly ToolCall[];
}): AssessmentRunMeta {
  const { responses, toolCalls } = input;
  const costs = responses.flatMap((r) => {
    const cost = r.metadata?.costs?.total_cost;
    return typeof cost === "number" ? [cost] : [];
  });
  const tokens = responses.flatMap((r) => {
    const total =
      r.metadata?.usage?.total_tokens ?? r.metadata?.costs?.total_tokens;
    return typeof total === "number" ? [total] : [];
  });
  const add = (a: number, b: number) => a + b;
  return {
    model: input.model,
    costUsd: costs.length ? costs.reduce(add, 0) : null,
    totalTokens: tokens.length ? tokens.reduce(add, 0) : null,
    durationMs: Date.now() - input.startedAt,
    prompts: input.prompts,
    toolCallsTotal: toolCalls.length,
    // Holmes hands the model an empty result for a failed tool and carries on,
    // so a clean-looking assessment can rest on missing data. Surfaced per run.
    toolCallsFailed: toolCalls.filter((c) => c.result?.status === "error").length,
    raw: responses.map(stored),
  };
}

/**
 * An assessment that failed, carrying what it still cost and did. The runner stores
 * that on the failed run: a failure with no model, no duration and no tool count is
 * a failure nobody can diagnose, and one with no cost looks free when it was not.
 */
export class AssessmentError extends Error {
  constructor(
    message: string,
    readonly meta: AssessmentRunMeta,
  ) {
    super(message);
  }
}

/**
 * Assess one job's workloads, in two phases.
 *
 * **Investigate** without `response_format`. Holmes passes the schema on EVERY turn
 * of its tool loop (holmes/core/tool_calling_llm.py), and the loop ends at the first
 * reply without tool calls. A provider that enforces the schema by constrained
 * decoding — the open-weight hosts that serve DeepSeek on OpenRouter — therefore
 * emits the JSON on turn one and never investigates. Gemini tolerates tools + schema,
 * but its schema-forced final turn over ~100 tool results is a long silent call.
 * The schema still travels as text (`outputContract`), so a model that follows it
 * finishes in this one call.
 *
 * **Format** only when that answer is not a clean assessment: a second call carrying
 * the investigation's own conversation history, the schema enforced, and an ask
 * that forbids further tools. Here schema-forcing on the first turn is precisely the
 * behaviour wanted. It is also the retry: a malformed or dropped answer costs one
 * short turn over existing evidence instead of a whole new investigation.
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
  /** Stops the investigation early — a cancelled run or a worker shutting down. */
  signal?: AbortSignal;
}): Promise<AssessmentOutcome> {
  const { cluster, category, model, targets, checks, playbook, signal } = input;
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
  const ask =
    buildAssessmentPrompt({
      category,
      clusterName: cluster.name,
      targets,
      checks,
      playbook: depth === "deep" ? playbook : undefined,
    }) + outputContract(responseFormat);
  const agent = { url: cluster.holmesUrl, apiKey: cluster.holmesApiKey };

  // The cluster investigation is wider than any workload's, so it is allowed
  // longer before the transport gives up on it.
  const timeoutMs =
    depth === "deep" && targets.some(isClusterTarget)
      ? CLUSTER_ASSESS_TIMEOUT_MS
      : ASSESS_TIMEOUT_MS[depth];

  const startedAt = Date.now();
  const responses: HolmesChatResponse[] = [];
  const toolCalls: ToolCall[] = [];
  const meta = () =>
    runMeta({
      model,
      startedAt,
      prompts: [{ target: describeTargets(targets), prompt: ask }],
      responses,
      toolCalls,
    });

  try {
    const investigation = await completeHolmesChat(
      agent,
      { ask, model, ...(depth === "posture" ? FAST_MODE : {}) },
      timeoutMs,
      toolCalls,
      signal,
    );
    responses.push(investigation);

    // Accepted as-is only when nothing had to be dropped in validation; anything
    // the validator rejected is worth one enforced-schema pass to recover. A usable
    // but imperfect answer is still kept as the fallback, so a failing format phase
    // can never turn a paid-for assessment into nothing.
    let fallback: Assessment | null = null;
    try {
      fallback = parseAssessment(investigation.analysis, allowedChecks, targets);
      if (fallback.rejected.length === 0)
        return { assessment: fallback, meta: meta() };
    } catch {
      // not an assessment at all — format it below
    }

    if (investigation.conversation_history.length === 0) {
      if (fallback) return { assessment: fallback, meta: meta() };
      throw new Error(
        "Holmes returned no conversation history, so its answer cannot be formatted",
      );
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < FORMAT_ATTEMPTS; attempt++) {
      // An interrupted run keeps whatever the investigation already produced
      // rather than spending a format call nobody will wait for.
      if (signal?.aborted) break;
      try {
        const formatted = await completeHolmesChat(
          agent,
          {
            ask: FORMAT_ASK,
            model,
            conversation_history: investigation.conversation_history,
            response_format: responseFormat,
            ...FAST_MODE,
          },
          FORMAT_TIMEOUT_MS,
          toolCalls,
          signal,
        );
        responses.push(formatted);
        return {
          assessment: parseAssessment(formatted.analysis, allowedChecks, targets),
          meta: meta(),
        };
      } catch (err) {
        lastError = err;
      }
    }
    if (fallback) return { assessment: fallback, meta: meta() };
    throw lastError ?? signal?.reason;
  } catch (err) {
    const phase = responses.length === 0 ? "investigation" : "formatting";
    throw new AssessmentError(
      `${phase} failed: ${err instanceof Error ? err.message : String(err)}`,
      meta(),
    );
  }
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
 */
export function mergeOutcomes(
  outcomes: readonly AssessmentOutcome[],
): AssessmentOutcome {
  if (outcomes.length === 0)
    throw new Error("No assessment outcomes to merge");

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
    meta: mergeRunMeta(outcomes.map((o) => o.meta)),
  };
}

/**
 * Sum several calls' metadata. Also how a deep run's FAILED workloads are counted:
 * their calls were really paid for, so they belong in the run's totals.
 *
 * Costs sum because they were all really spent. `durationMs` also sums, because the
 * calls run sequentially — LLM rate limits, same reason the queue drains serially.
 */
export function mergeRunMeta(
  metas: readonly AssessmentRunMeta[],
): AssessmentRunMeta {
  if (metas.length === 0) throw new Error("No run metadata to merge");
  const sum = (pick: (m: AssessmentRunMeta) => number | null) =>
    metas.reduce((total, m) => total + (pick(m) ?? 0), 0);
  // Distinguish "nothing was reported" from "the total was zero": if no call
  // returned a cost, the run's cost is unknown rather than free.
  const sumOrNull = (pick: (m: AssessmentRunMeta) => number | null) =>
    metas.some((m) => pick(m) !== null) ? sum(pick) : null;
  return {
    model: metas[0].model,
    costUsd: sumOrNull((m) => m.costUsd),
    totalTokens: sumOrNull((m) => m.totalTokens),
    durationMs: sum((m) => m.durationMs),
    toolCallsTotal: sum((m) => m.toolCallsTotal),
    toolCallsFailed: sum((m) => m.toolCallsFailed),
    // One entry per call. Keeping every response is what makes a per-workload run
    // auditable after the fact. flatMap, so merging merged metadata stays flat.
    raw: metas.flatMap((m) => m.raw),
    prompts: metas.flatMap((m) => m.prompts),
  };
}
