import { getAuthContext, unauthorized } from "@/lib/auth/session";
import {
  createSkill,
  listSkills,
  SkillNameTaken,
} from "@/lib/db/skill-queries";
import { validateSkillDraft } from "@/lib/skills/types";

/** GET /api/skills — the skills this member can see (org admins: all of the org's). */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  try {
    return Response.json(await listSkills(ctx));
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

/** POST /api/skills — create a private skill owned by the caller. */
export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
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
    return Response.json(await createSkill(ctx, draft), { status: 201 });
  } catch (err) {
    if (err instanceof SkillNameTaken)
      return Response.json({ error: err.message }, { status: 409 });
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
