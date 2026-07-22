import "server-only";
import type { AgentTarget } from "@/lib/holmes/stream";
import { parseArtifactDraft, type ArtifactDraft } from "./types";

const DISTILL_TIMEOUT_MS = 120_000;
/** Keep the distillation ask well under context limits (~12k tokens). */
const TRANSCRIPT_BUDGET_CHARS = 48_000;

/**
 * Strict JSON schema Holmes must fill via `response_format`. strict mode
 * requires every property to be present — the prompt allows ""/[] when
 * something is genuinely unknown.
 */
export const ARTIFACT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "resolution_artifact",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "title",
        "summary",
        "symptoms",
        "affected_services",
        "root_cause",
        "resolution_steps",
        "verification_steps",
        "tags",
        "graph",
      ],
      properties: {
        title: {
          type: "string",
          description: "Short incident title, at most 80 characters",
        },
        summary: {
          type: "string",
          description: "2-4 sentence overview of problem and fix (markdown)",
        },
        symptoms: {
          type: "array",
          items: { type: "string" },
          description:
            "Observable symptoms: exact error messages, alert names, user-visible failures",
        },
        affected_services: {
          type: "array",
          items: { type: "string" },
          description:
            "Exact service/deployment names as they appear in the cluster",
        },
        root_cause: {
          type: "string",
          description: "The confirmed root cause (markdown)",
        },
        resolution_steps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered steps that fixed the problem (markdown each)",
        },
        verification_steps: {
          type: "array",
          items: { type: "string" },
          description: "How to verify the fix worked",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Lowercase kebab-case topic tags",
        },
        graph: {
          type: "object",
          additionalProperties: false,
          required: ["nodes", "edges"],
          description:
            "Failure-propagation graph over the involved services/components",
          properties: {
            nodes: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["id", "label", "kind"],
                properties: {
                  id: { type: "string" },
                  label: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["service", "component", "datastore", "external"],
                  },
                },
              },
            },
            edges: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["source", "target", "label"],
                properties: {
                  source: { type: "string" },
                  target: { type: "string" },
                  label: {
                    type: "string",
                    description:
                      "How the failure propagates along this edge; empty string if plain dependency",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

const DISTILL_PROMPT = `You are distilling a finished, RESOLVED investigation into a knowledge-base artifact for other engineers who will hit the same problem.

Rules:
- Use ONLY the transcript below. Do NOT run tools. Do NOT invent services, errors, or steps that are not in the transcript.
- affected_services: exact names as seen in the cluster/logs.
- graph: nodes are the involved services/components/datastores/external systems; edge direction is failure propagation (source's failure impacts target). Keep it small and truthful — only relationships evidenced in the transcript.
- Use "" or [] for anything genuinely unknown.

Transcript of the investigation:

`;

/**
 * Condense the conversation to user asks + assistant analyses. When over
 * budget, keep the first ask (problem statement) and as many trailing
 * turns as fit — the resolution lives at the end.
 */
export function buildTranscript(
  turns: { role: string; content: string }[],
): string {
  const rendered = turns.map(
    (t) => `${t.role === "user" ? "USER" : "HOLMES"}:\n${t.content.trim()}`,
  );
  const total = rendered.reduce((n, t) => n + t.length + 2, 0);
  if (total <= TRANSCRIPT_BUDGET_CHARS) return rendered.join("\n\n");

  const head = rendered[0];
  const budget = TRANSCRIPT_BUDGET_CHARS - head.length;
  const tail: string[] = [];
  let used = 0;
  for (let i = rendered.length - 1; i > 0; i--) {
    const chunk = rendered[i];
    if (used + chunk.length > budget) break;
    tail.unshift(chunk);
    used += chunk.length + 2;
  }
  return [head, "[… earlier turns omitted …]", ...tail].join("\n\n");
}

async function askHolmes(
  agent: AgentTarget,
  model: string,
  ask: string,
): Promise<string> {
  const base = agent.url.replace(/\/$/, "");
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agent.apiKey}`,
    },
    body: JSON.stringify({
      ask,
      model,
      stream: false,
      response_format: ARTIFACT_RESPONSE_FORMAT,
    }),
    signal: AbortSignal.timeout(DISTILL_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Holmes API ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as { analysis?: unknown };
  if (typeof data.analysis !== "string")
    throw new Error("Holmes response has no analysis");
  return data.analysis;
}

/**
 * One distillation call against the user's own Holmes agent, with a single
 * retry when the structured output comes back malformed.
 */
export async function distillArtifact(
  agent: AgentTarget,
  model: string,
  turns: { role: string; content: string }[],
): Promise<ArtifactDraft> {
  const ask = DISTILL_PROMPT + buildTranscript(turns);
  try {
    return parseArtifactDraft(await askHolmes(agent, model, ask));
  } catch {
    const retryAsk =
      ask +
      "\n\nIMPORTANT: Return ONLY the JSON object matching the schema — no prose, no code fences.";
    return parseArtifactDraft(await askHolmes(agent, model, retryAsk));
  }
}
