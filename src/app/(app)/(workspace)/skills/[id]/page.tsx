import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSkillView } from "@/lib/db/skill-queries";
import { NewSkill } from "@/components/skills/new-skill";
import { SkillDetail } from "@/components/skills/skill-detail";

/**
 * `/skills/new` creates (`?start=holmes`: with the Holmes drafter open;
 * `?from=conversation`: the chat's skill builder; `?from=duplicate`: a copy);
 * `/skills/<id>` shows one, with editing and sharing as modes of that page.
 */
export default async function SkillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; start?: string }>;
}) {
  const { id } = await params;
  const { from, start } = await searchParams;
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const skill =
    id === "new" ? null : await getSkillView(ctx, id).catch(() => null);
  if (id !== "new" && !skill) notFound();

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      {skill ? (
        // Keyed by the version, so a newer server copy (a refresh) replaces local state.
        <SkillDetail key={`${skill.id}:${skill.updatedAt}`} skill={skill} />
      ) : (
        <NewSkill from={from} start={start} />
      )}
    </main>
  );
}
