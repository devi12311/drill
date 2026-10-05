import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthUser } from "@/lib/auth/session";
import { getSkillView, skillActor } from "@/lib/db/skill-queries";
import { SkillScope } from "@/components/skills/skill-badges";
import { SkillEditor } from "@/components/skills/skill-editor";

/** `/skills/new` creates; `/skills/<id>` edits (or shows, when not editable). */
export default async function SkillPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const skill =
    id === "new" ? null : await getSkillView(skillActor(user), id).catch(() => null);
  if (id !== "new" && !skill) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 pb-20 pt-8">
        <Link
          href="/skills"
          className="inline-flex items-center gap-2 text-body-sm text-bone-gray hover:text-warm-off-white"
        >
          <ArrowLeft className="size-3.5" />
          Skills
        </Link>
        <div className="mt-6 mb-8 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-0 text-heading text-warm-off-white">
            {skill ? <span className="font-mono break-all">{skill.name}</span> : "New skill"}
          </h1>
          {skill && <SkillScope skill={skill} />}
        </div>
        <SkillEditor skill={skill} />
      </div>
    </main>
  );
}
