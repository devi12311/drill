"use client";

import Link from "next/link";
import { NewSkillOptions } from "@/components/skills/new-skill";
import { SkillScope } from "@/components/skills/skill-badges";
import { useSkills } from "@/components/skills/use-skills";

/**
 * The skills library: procedures Holmes follows. Everyone writes private ones;
 * org admins make them org-wide (and mark standing team instructions always-on).
 */
export default function SkillsPage() {
  const { skills, error } = useSkills();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[920px] px-6 pb-20 pt-8">
        <div>
          <div className="text-caption-tracked uppercase text-bone-gray">
            Procedures
          </div>
          <h1 className="mt-2 text-heading text-warm-off-white">Skills</h1>
          <p className="mt-1 max-w-[62ch] text-body text-pale-stone">
            Step-by-step procedures Holmes follows. It picks a matching skill
            on its own, or you run one directly from the composer with its
            inputs. New skills are private to you; an org admin can make them org-wide.
          </p>
        </div>

        <div className="mt-6">
          <NewSkillOptions />
        </div>

        <div className="mt-8">
          <h2 className="text-caption-tracked uppercase text-bone-gray">
            {skills?.length ? `Library · ${skills.length}` : "Library"}
          </h2>
          <div className="mt-2">
            {error ? (
              <p className="py-8 text-body-sm text-traffic-red">{error}</p>
            ) : !skills ? (
              <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
            ) : skills.length === 0 ? (
              <p className="py-8 text-body-sm text-bone-gray">
                No skills yet — start one above with the procedure you keep explaining to Holmes.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {skills.map((skill) => (
                  <Link
                    key={skill.id}
                    href={`/skills/${skill.id}`}
                    className="block rounded-lg border border-border bg-smoked-onyx p-4 transition-colors hover:border-slate-hearth hover:bg-smoke-charcoal"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-mono text-body-sm text-warm-off-white">
                        {skill.name}
                      </span>
                      <SkillScope skill={skill} />
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-body-sm text-pale-stone">
                      {skill.description}
                    </p>
                    <div className="mt-3 text-caption-tracked uppercase text-bone-gray">
                      {[
                        skill.createdByName ?? "former user",
                        skill.inputs.length
                          ? `${skill.inputs.length} input${skill.inputs.length === 1 ? "" : "s"}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
