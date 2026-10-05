import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  deleteSkill,
  getSkillView,
  skillActor,
  SkillNameTaken,
  updateSkill,
  type SkillPatch,
} from "@/lib/db/skill-queries";
import { SKILL_VISIBILITIES, validateSkillDraft, type SkillVisibility } from "@/lib/skills/types";

type Context = { params: Promise<{ id: string }> };

const DRAFT_FIELDS = ["name", "description", "body", "inputs"] as const;

/** Private skills 404 for everyone but their author (and admins). */
export async function GET(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    const skill = await getSkillView(skillActor(user), id);
    if (!skill) return Response.json({ error: "Skill not found" }, { status: 404 });
    return Response.json(skill);
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

/**
 * Edit the draft fields (sent together — validated as a whole, like a create)
 * and/or, admins only, `visibility` and `alwaysOn`.
 */
export async function PATCH(request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const actor = skillActor(user);

  let patch: SkillPatch;
  try {
    const raw = ((await request.json()) ?? {}) as Record<string, unknown>;
    patch = DRAFT_FIELDS.some((f) => f in raw) ? validateSkillDraft(raw) : {};
    if ("visibility" in raw) {
      if (!SKILL_VISIBILITIES.includes(raw.visibility as SkillVisibility))
        throw new Error("visibility must be private or shared");
      patch.visibility = raw.visibility as SkillVisibility;
    }
    if ("alwaysOn" in raw) patch.alwaysOn = raw.alwaysOn === true;
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid skill" },
      { status: 400 },
    );
  }

  try {
    const result = await updateSkill(actor, id, patch);
    if (!result.ok) {
      const status = { not_found: 404, forbidden: 403, invalid: 400 }[result.reason];
      const error =
        result.message ??
        (result.reason === "not_found"
          ? "Skill not found"
          : "Only an admin can edit a shared skill");
      return Response.json({ error }, { status });
    }
    // Sharing decides what every user's investigations are steered by — keep a
    // record of who decided it, and of admin edits to what is already shared.
    const { before, skill } = result;
    if (
      actor.isAdmin &&
      (before.visibility !== skill.visibility ||
        before.alwaysOn !== skill.alwaysOn ||
        skill.visibility === "shared")
    ) {
      await writeAudit({
        actorId: actor.id,
        action: "skill.update",
        targetUserId: before.createdBy,
        metadata: {
          skillId: skill.id,
          name: skill.name,
          visibility: [before.visibility, skill.visibility],
          alwaysOn: [before.alwaysOn, skill.alwaysOn],
          contentChanged: before.body !== skill.body || before.description !== skill.description,
        },
      });
    }
    return Response.json(skill);
  } catch (err) {
    if (err instanceof SkillNameTaken)
      return Response.json({ error: err.message }, { status: 409 });
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const actor = skillActor(user);
  try {
    const result = await deleteSkill(actor, id);
    if (!result.ok) {
      return result.reason === "not_found"
        ? Response.json({ error: "Skill not found" }, { status: 404 })
        : Response.json({ error: "Only an admin can delete a shared skill" }, { status: 403 });
    }
    if (actor.isAdmin && result.before.visibility === "shared") {
      await writeAudit({
        actorId: actor.id,
        action: "skill.delete",
        targetUserId: result.before.createdBy,
        metadata: { skillId: id, name: result.before.name },
      });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
