import "server-only";
import { searchArtifactRows, type ArtifactSearchRow } from "@/lib/db/queries";
import type { FrontendToolDef } from "@/lib/holmes/types";

export type ArtifactHit = ArtifactSearchRow;

export interface ArtifactSearchOpts {
  service?: string;
  tag?: string;
  limit?: number;
}

/**
 * Below this hybrid score a hit is treated as noise by the knowledge
 * integrations (injection / frontend tool). The library page shows
 * everything the query matched regardless.
 */
export const RELEVANCE_FLOOR = 0.03;

/**
 * websearch_to_tsquery ANDs terms, which almost never matches when the
 * query is a whole incident description. Rebuild it as an OR query
 * (ranking still rewards documents matching more terms).
 */
function toOrQuery(q: string): string {
  const words = q
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((w) => w.length > 1)
    .slice(0, 32);
  return words.join(" or ");
}

/**
 * The single search entry point shared by system-prompt injection, the
 * `search_past_resolutions` frontend tool, and the resolutions library.
 */
export async function searchArtifacts(
  q: string,
  opts: ArtifactSearchOpts = {},
): Promise<ArtifactHit[]> {
  return searchArtifactRows({
    tsQuery: toOrQuery(q),
    rawQuery: q.trim(),
    service: opts.service,
    tag: opts.tag,
    limit: opts.limit ?? 10,
  });
}

// ---- Holmes knowledge integration ----

/** The exact citation marker Holmes is told to emit (rendered as a chip). */
export const CITE_INSTRUCTION =
  "cite it inline with exactly [[artifact:<id>]] (Drill renders that marker as a link the user can open)";

export const SEARCH_TOOL_NAME = "search_past_resolutions";

export const SEARCH_TOOL_DEF: FrontendToolDef = {
  name: SEARCH_TOOL_NAME,
  description:
    "Search Drill's knowledge base of previously RESOLVED incidents in this exact infrastructure. " +
    "Use it when symptoms look familiar, before deep-diving a service, or when the user asks about past incidents. " +
    "Returns resolution artifacts with id, title, symptoms, root_cause and resolution_steps. " +
    `When an artifact informs your answer, ${CITE_INSTRUCTION}.`,
  mode: "pause",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Free-text search: symptoms, error messages, service names",
      },
    },
    required: ["query"],
  },
};

/**
 * Execute the frontend tool server-side. Always resolves to a JSON string
 * (Holmes requires string results); never throws — a broken knowledge base
 * must not kill a live investigation.
 */
export async function runSearchTool(args: unknown): Promise<string> {
  let query = "";
  try {
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    query = String(
      (parsed as Record<string, unknown> | null)?.query ?? "",
    ).trim();
  } catch {
    // fall through with empty query
  }
  if (!query) {
    return JSON.stringify({ results: [], note: "empty query" });
  }
  try {
    const hits = (await searchArtifacts(query, { limit: 5 })).filter(
      (h) => h.score >= RELEVANCE_FLOOR,
    );
    if (!hits.length) {
      return JSON.stringify({
        results: [],
        note: "no past resolutions matched",
      });
    }
    return JSON.stringify({
      results: hits.map((h) => ({
        id: h.id,
        title: h.title,
        affected_services: h.affected_services,
        symptoms: h.symptoms.slice(0, 6),
        root_cause: h.root_cause.slice(0, 600),
        resolution_steps: h.resolution_steps
          .slice(0, 6)
          .map((s) => s.slice(0, 300)),
      })),
      usage: `when an artifact is relevant, ${CITE_INSTRUCTION}`,
    });
  } catch {
    return JSON.stringify({
      results: [],
      note: "knowledge base temporarily unavailable",
    });
  }
}

const INJECTION_BLOCK_CHARS = 700;

/** Knowledge block appended to Holmes's system prompt on each ask. */
export function buildInjectionPrompt(hits: ArtifactHit[]): string {
  const blocks = hits.map((h) => {
    const block = [
      `[[artifact:${h.id}]] "${h.title}"`,
      `  services: ${h.affected_services.join(", ") || "-"}`,
      `  symptoms: ${h.symptoms.slice(0, 4).join("; ") || "-"}`,
      `  root cause: ${h.root_cause}`,
      `  resolution: ${h.resolution_steps.slice(0, 2).join(" → ")}`,
    ].join("\n");
    return block.length > INJECTION_BLOCK_CHARS
      ? block.slice(0, INJECTION_BLOCK_CHARS) + "…"
      : block;
  });
  return `## Drill knowledge base — past resolved incidents

These previously resolved incidents may match the user's problem:

${blocks.join("\n\n")}

Rules: if one of these matches the problem, say so early and ${CITE_INSTRUCTION}. Only cite ids listed here or returned by the ${SEARCH_TOOL_NAME} tool. Verify against live data before assuming an old root cause applies to the current incident.`;
}
