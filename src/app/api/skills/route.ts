import { getAuthUser, unauthorized } from "@/lib/auth/session";
import {
  createSkill,
  listSkills,
  skillActor,
  SkillNameTaken,
} from "@/lib/db/skill-queries";
import { validateSkillDraft } from "@/lib/skills/types";

/** GET /api/skills — the skills this user can see (admins: all of them). */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  try {
    return Response.json(await listSkills(skillActor(user)));
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

/** POST /api/skills — create a private skill owned by the caller. */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  let draft;
  try {
    draft = validateSkillDraft(await request.json());
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid skill" },
      { status: 400 },
    );
  }
  try {
    return Response.json(await createSkill(skillActor(user), draft), { status: 201 });
  } catch (err) {
    if (err instanceof SkillNameTaken)
      return Response.json({ error: err.message }, { status: 409 });
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
