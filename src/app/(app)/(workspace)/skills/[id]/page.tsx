import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { getSkillView } from "@/lib/db/skill-queries";
import { SkillScope } from "@/components/skills/skill-badges";
import { SkillEditor } from "@/components/skills/skill-editor";

/**
 * `/skills/new` creates (`?from=conversation`: from the chat's skill builder);
 * `/skills/<id>` edits (or shows, when not editable).
 */
export default async function SkillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const skill =
    id === "new" ? null : await getSkillView(ctx, id).catch(() => null);
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
        <SkillEditor skill={skill} fromConversation={from === "conversation"} />
      </div>
    </main>
  );
}
