import type { SkillView } from "@/lib/skills/types";

/**
 * Where a skill reaches: just its author, everyone in the org, or every turn.
 * "Org-wide" rather than the stored `shared`, so it does not read like the
 * Share menu's copy-by-link.
 */
export function SkillScope({ skill }: { skill: Pick<SkillView, "visibility" | "alwaysOn"> }) {
  const label = skill.alwaysOn ? "always-on" : skill.visibility === "shared" ? "org-wide" : "private";
  return (
    <span className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 text-caption-tracked uppercase text-pale-stone">
      {label}
    </span>
  );
}
