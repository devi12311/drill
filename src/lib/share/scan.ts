import { ARTIFACT_MARKER, type ArtifactDraft } from "@/lib/artifacts/types";
import { LONG_HEX_PATTERN, UUID_PATTERN } from "@/lib/skills/conversation-steps";
import type { SkillDraft } from "@/lib/skills/types";

/**
 * What a share link would carry out of the org that identifies it — shown to
 * the sharer before the link exists. Warnings, never blocks: a service name in
 * a resolution is often the point of sharing it, and only the sharer can tell.
 * Client-safe, so the dialog shows exactly what the API would see.
 */

export interface ShareFinding {
  label: string;
  values: string[];
}

const SHAPES: { label: string; pattern: RegExp }[] = [
  { label: "IDs", pattern: UUID_PATTERN },
  { label: "IDs", pattern: LONG_HEX_PATTERN },
  { label: "IP addresses", pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
  { label: "Email addresses", pattern: /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g },
  // Two dots or more: in-cluster DNS (svc.namespace.svc.<domain>) and FQDNs,
  // not `values.yaml`. The last label may hold digits/hyphens (k8s-clickflare).
  {
    label: "Hostnames",
    pattern: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){2,}[a-z][a-z0-9-]*[a-z0-9]\b/gi,
  },
];

function collect(texts: readonly string[], extra: ShareFinding[] = []): ShareFinding[] {
  const groups = new Map<string, Set<string>>();
  const add = (label: string, value: string) => {
    if (!groups.has(label)) groups.set(label, new Set());
    groups.get(label)!.add(value);
  };
  for (const text of texts)
    for (const { label, pattern } of SHAPES)
      for (const m of text.matchAll(pattern)) add(label, m[0]);
  for (const { label, values } of extra) for (const v of values) add(label, v);
  return [...groups].map(([label, values]) => ({ label, values: [...values] }));
}

export function scanSkill(draft: SkillDraft): ShareFinding[] {
  return collect([draft.description, draft.body]);
}

export function scanArtifact(draft: ArtifactDraft): ShareFinding[] {
  const names = new Set([
    ...draft.affected_services,
    ...draft.graph.nodes.flatMap((n) => [n.id, n.label]),
  ]);
  return collect(
    [
      draft.title,
      draft.summary,
      draft.root_cause,
      ...draft.symptoms,
      ...draft.resolution_steps,
      ...draft.verification_steps,
      ...draft.graph.edges.map((e) => e.label),
    ],
    names.size ? [{ label: "Service and component names", values: [...names] }] : [],
  );
}

const CITATION = new RegExp(` ?${ARTIFACT_MARKER.source}`, "gi");

/**
 * `[[artifact:<uuid>]]` citations name rows of the sharing org: in another org
 * they resolve to nothing and only leak ids. Dropped before anything is shared.
 */
export function stripArtifactCitations(draft: ArtifactDraft): ArtifactDraft {
  // The marker and the one space before it — never other whitespace, which is
  // markdown structure (list nesting, code indentation).
  const strip = (text: string) => text.replace(CITATION, "").trim();
  return {
    ...draft,
    summary: strip(draft.summary),
    root_cause: strip(draft.root_cause),
    symptoms: draft.symptoms.map(strip).filter(Boolean),
    resolution_steps: draft.resolution_steps.map(strip).filter(Boolean),
    verification_steps: draft.verification_steps.map(strip).filter(Boolean),
  };
}
