import type { SkillView } from "@/lib/skills/types";

/** Where a skill reaches: just its author, everyone, or every turn. */
export function SkillScope({ skill }: { skill: Pick<SkillView, "visibility" | "alwaysOn"> }) {
  const label = skill.alwaysOn ? "always-on" : skill.visibility;
  return (
    <span className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 text-caption-tracked uppercase text-pale-stone">
      {label}
    </span>
  );
}
