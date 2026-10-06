import "server-only";
import { getUsableSkill, usableSkills } from "@/lib/db/skill-queries";
import type { FrontendToolContext, FrontendToolOutcome } from "@/lib/holmes/frontend-tools";
import type { FrontendToolDef } from "@/lib/holmes/types";
import { FETCH_SKILL_TOOL_NAME, renderFetched } from "./prompt";

export const FETCH_SKILL_TOOL_DEF: FrontendToolDef = {
  name: FETCH_SKILL_TOOL_NAME,
  description:
    "Get the step-by-step procedure of one of the Drill skills listed in the system prompt. " +
    "Use it when a listed skill clearly matches the issue, then follow its steps with your other tools.",
  mode: "pause",
  parameters: {
    type: "object",
    properties: {
      skill_name: {
        type: "string",
        description: "Exactly as listed in the Drill skills catalog, e.g. checkout-latency-investigation",
      },
    },
    required: ["skill_name"],
  },
};

/**
 * Resolved for the turn's user at call time, not from the catalog the request
 * was built with — so a skill deleted or unshared mid-investigation is gone, and
 * one user can never fetch another's private skill by guessing its name.
 */
export async function runFetchSkill(
  args: Record<string, unknown>,
  ctx: FrontendToolContext,
): Promise<FrontendToolOutcome> {
  const name = String(args.skill_name ?? "").trim();
  const skill = name ? await getUsableSkill(ctx, { name }) : null;
  if (skill) return { data: renderFetched(skill), status: "success" };
  // Same shape as Holmes's own miss, so the model recovers the same way.
  const available = (await usableSkills(ctx))
    .filter((s) => !s.alwaysOn)
    .map((s) => s.name);
  return {
    data: `Skill '${name}' not found. Available: ${available.join(", ") || "none"}`,
    status: "error",
  };
}
