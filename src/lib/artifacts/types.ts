/**
 * Resolution artifact shapes. `ArtifactDraft` is exactly what Holmes is
 * asked to produce via `response_format` (snake_case keys) and what the
 * review dialog edits before saving.
 */

export type ArtifactNodeKind =
  | "service"
  | "component"
  | "datastore"
  | "external";

export interface ArtifactGraphNode {
  id: string;
  label: string;
  kind: ArtifactNodeKind;
}

/** Edge direction = failure propagation (source's failure impacts target). */
export interface ArtifactGraphEdge {
  source: string;
  target: string;
  label: string;
}

export interface ArtifactGraph {
  nodes: ArtifactGraphNode[];
  edges: ArtifactGraphEdge[];
}

export interface ArtifactDraft {
  title: string;
  summary: string;
  symptoms: string[];
  affected_services: string[];
  root_cause: string;
  resolution_steps: string[];
  verification_steps: string[];
  tags: string[];
  graph: ArtifactGraph;
}

const NODE_KINDS: ArtifactNodeKind[] = [
  "service",
  "component",
  "datastore",
  "external",
];

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    out.push(trimmed);
  }
  return out;
}

export function normalizeGraph(value: unknown): ArtifactGraph {
  const raw = (value ?? {}) as Partial<ArtifactGraph>;
  const nodes: ArtifactGraphNode[] = [];
  const ids = new Set<string>();
  for (const node of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (!node || typeof node.id !== "string" || !node.id.trim()) continue;
    const id = node.id.trim();
    if (ids.has(id)) continue;
    ids.add(id);
    nodes.push({
      id,
      label:
        typeof node.label === "string" && node.label.trim()
          ? node.label.trim()
          : id,
      kind: NODE_KINDS.includes(node.kind as ArtifactNodeKind)
        ? (node.kind as ArtifactNodeKind)
        : "component",
    });
  }
  const edges: ArtifactGraphEdge[] = [];
  for (const edge of Array.isArray(raw.edges) ? raw.edges : []) {
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string")
      continue;
    const source = edge.source.trim();
    const target = edge.target.trim();
    // Edges referencing unknown nodes are dropped rather than invented.
    if (!ids.has(source) || !ids.has(target)) continue;
    edges.push({
      source,
      target,
      label: typeof edge.label === "string" ? edge.label.trim() : "",
    });
  }
  return { nodes, edges };
}

/**
 * Validate an already-parsed draft object (Holmes output or a client
 * save/edit payload). Throws with a readable message on malformed input.
 */
export function validateDraft(parsed: unknown): ArtifactDraft {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error("artifact is not a JSON object");
  const obj = parsed as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (!title) throw new Error("artifact is missing a title");
  return {
    title: title.slice(0, 120),
    summary: typeof obj.summary === "string" ? obj.summary.trim() : "",
    symptoms: stringList(obj.symptoms),
    affected_services: stringList(obj.affected_services),
    root_cause: typeof obj.root_cause === "string" ? obj.root_cause.trim() : "",
    resolution_steps: stringList(obj.resolution_steps),
    verification_steps: stringList(obj.verification_steps),
    tags: stringList(obj.tags).map((t) =>
      t.toLowerCase().replace(/\s+/g, "-"),
    ),
    graph: normalizeGraph(obj.graph),
  };
}

/**
 * Parse Holmes's structured `analysis` string into a validated draft.
 * Throws with a readable message on malformed input (caller retries once).
 */
export function parseArtifactDraft(raw: string): ArtifactDraft {
  let text = raw.trim();
  const fence = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  if (fence) text = fence[1];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("artifact response is not valid JSON");
  }
  return validateDraft(parsed);
}
