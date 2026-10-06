import "server-only";
import {
  buildInjectionPrompt,
  RELEVANCE_FLOOR,
  searchArtifacts,
} from "@/lib/artifacts/search";
import type { Scope } from "@/lib/db/queries";
import { usableSkills } from "@/lib/db/skill-queries";
import { FRONTEND_TOOL_DEFS } from "@/lib/holmes/frontend-tools";
import type { HolmesChatRequest } from "@/lib/holmes/types";
import { alwaysOnBlock, catalogBlock } from "@/lib/skills/prompt";

/**
 * Everything Drill adds to a live chat request on top of the question: its
 * frontend tools, and a system prompt assembled from the knowledge base and the
 * user's skills. The one place this is built — the stored request carries it
 * through every pause and automatic resume (lib/chat/resume.ts copies it).
 *
 * Each part degrades on its own: a broken knowledge base or skills table drops
 * that part and the investigation runs without it.
 */
export async function buildHolmesExtras(input: {
  /** The question searched against past resolutions; absent on a decision. */
  ask: string | null;
  scope: Scope;
}): Promise<Pick<HolmesChatRequest, "frontend_tools" | "additional_system_prompt" | "enable_tool_approval">> {
  const extras = {
    enable_tool_approval: true,
    frontend_tools: FRONTEND_TOOL_DEFS,
  };
  // A decision resumes Holmes's paused history as-is (Holmes does not rebuild
  // the system prompt for it), so there is nothing to assemble.
  if (input.ask == null) return extras;

  const [knowledge, skills] = await Promise.all([
    searchArtifacts(input.ask, { orgId: input.scope.orgId, limit: 3 })
      .then((hits) => hits.filter((h) => h.score >= RELEVANCE_FLOOR))
      .then((hits) => (hits.length ? buildInjectionPrompt(hits) : null))
      .catch(() => null),
    usableSkills(input.scope)
      .then((rows) => {
        const standing = rows.filter((s) => s.alwaysOn);
        const listed = rows.filter((s) => !s.alwaysOn);
        return [
          standing.length ? alwaysOnBlock(standing) : null,
          listed.length ? catalogBlock(listed) : null,
        ];
      })
      .catch(() => [null, null]),
  ]);
  const prompt = [...skills, knowledge].filter(Boolean).join("\n\n");
  return prompt ? { ...extras, additional_system_prompt: prompt } : extras;
}
