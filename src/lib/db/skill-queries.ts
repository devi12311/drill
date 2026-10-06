import "server-only";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { db, isUniqueViolation } from "./index";
import { skills, users } from "./schema";
import type { ManagerScope, Scope } from "./queries";
import { isUuid } from "@/lib/uuid";
import type {
  SkillDraft,
  SkillView,
  SkillVisibility,
} from "@/lib/skills/types";

type SkillRow = typeof skills.$inferSelect;


/**
 * Who is asking — the effective user in their active org (an AuthContext passes
 * straight in), so impersonation sees what they see. "Admin" here is the ORG
 * admin: skills are moderated per org.
 */
export type SkillActor = ManagerScope;

/**
 * A private skill is its author's alone; a shared one changes every member's
 * investigations, so once shared only an org admin may edit it — otherwise
 * sharing would be a review the author could undo by editing afterwards.
 * Callers only ever hand these rows of the actor's own org.
 */
function canSee(actor: SkillActor, row: SkillRow): boolean {
  return (
    actor.isOrgAdmin ||
    row.visibility === "shared" ||
    row.createdBy === actor.userId
  );
}

function canEdit(actor: SkillActor, row: SkillRow): boolean {
  if (actor.isOrgAdmin) return true;
  return row.visibility === "private" && row.createdBy === actor.userId;
}

const inOrg = (orgId: string) => eq(skills.orgId, orgId);

/** Skills that reach this member's investigations: their own plus the org's shared ones. */
const usableBy = (scope: Scope) =>
  and(
    inOrg(scope.orgId),
    or(eq(skills.visibility, "shared"), eq(skills.createdBy, scope.userId)),
  );

function toView(
  actor: SkillActor,
  row: SkillRow,
  createdByName: string | null,
): SkillView {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    inputs: row.inputs,
    visibility: row.visibility,
    alwaysOn: row.alwaysOn,
    createdBy: row.createdBy,
    createdByName,
    updatedAt: row.updatedAt.toISOString(),
    editable: canEdit(actor, row),
  };
}

const withAuthor = () =>
  db
    .select({ row: skills, author: users.username })
    .from(skills)
    .leftJoin(users, eq(users.id, skills.createdBy));

/**
 * The library page. Org admins see every skill in the org, members' private ones
 * included — they moderate what gets shared.
 */
export async function listSkills(actor: SkillActor): Promise<SkillView[]> {
  const rows = await withAuthor()
    .where(actor.isOrgAdmin ? inOrg(actor.orgId) : usableBy(actor))
    .orderBy(desc(skills.visibility), asc(skills.name));
  return rows.map(({ row, author }) => toView(actor, row, author));
}

export async function getSkillView(
  actor: SkillActor,
  id: string,
): Promise<SkillView | null> {
  if (!isUuid(id)) return null;
  const [found] = await withAuthor().where(
    and(eq(skills.id, id), inOrg(actor.orgId)),
  );
  if (!found) return null;
  const { row, author } = found;
  if (!canSee(actor, row)) return null;
  return toView(actor, row, author);
}

/**
 * What an investigation may use, for the catalog and always-on blocks. Org admins
 * get the same set as anyone — another member's private skill never steers theirs.
 */
export async function usableSkills(scope: Scope): Promise<SkillRow[]> {
  return db
    .select()
    .from(skills)
    .where(usableBy(scope))
    // Shared first: when the catalog is capped, the reviewed ones survive.
    .orderBy(desc(skills.visibility), desc(skills.updatedAt));
}

/** One usable skill by name (what the model passes) or id (what the UI sends). */
export async function getUsableSkill(
  scope: Scope,
  ref: { name: string } | { id: string },
): Promise<SkillRow | null> {
  if ("id" in ref && !isUuid(ref.id)) return null;
  const match =
    "name" in ref ? eq(skills.name, ref.name) : eq(skills.id, ref.id);
  const [row] = await db
    .select()
    .from(skills)
    .where(and(match, usableBy(scope)));
  return row ?? null;
}

export class SkillNameTaken extends Error {
  constructor(name: string) {
    super(`A skill named "${name}" already exists`);
  }
}

function rethrowUnique(err: unknown, name: string): never {
  if (isUniqueViolation(err)) throw new SkillNameTaken(name);
  throw err;
}

/** New skills always start private; sharing is a separate, org-admin-only step. */
export async function createSkill(
  actor: SkillActor,
  draft: SkillDraft,
): Promise<SkillView> {
  try {
    const [row] = await db
      .insert(skills)
      .values({
        ...draft,
        orgId: actor.orgId,
        createdBy: actor.userId,
        lastEditedBy: actor.userId,
      })
      .returning();
    return (await getSkillView(actor, row.id))!;
  } catch (err) {
    rethrowUnique(err, draft.name);
  }
}

export interface SkillPatch extends Partial<SkillDraft> {
  visibility?: SkillVisibility;
  alwaysOn?: boolean;
}

type SkillWriteResult =
  | { ok: true; skill: SkillView; before: SkillRow }
  | { ok: false; reason: "not_found" | "forbidden" | "invalid"; message?: string };

export async function updateSkill(
  actor: SkillActor,
  id: string,
  patch: SkillPatch,
): Promise<SkillWriteResult> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, id), inOrg(actor.orgId)));
  if (!row || !canSee(actor, row)) return { ok: false, reason: "not_found" };
  if (!canEdit(actor, row)) return { ok: false, reason: "forbidden" };
  if ((patch.visibility !== undefined || patch.alwaysOn !== undefined) && !actor.isOrgAdmin)
    return { ok: false, reason: "forbidden", message: "Only an org admin can share a skill or make it always-on" };

  const visibility = patch.visibility ?? row.visibility;
  const alwaysOn = visibility === "shared" ? (patch.alwaysOn ?? row.alwaysOn) : false;
  if (patch.alwaysOn && visibility !== "shared")
    return { ok: false, reason: "invalid", message: "Only a shared skill can be always-on" };

  try {
    await db
      .update(skills)
      .set({
        ...patch,
        visibility,
        alwaysOn,
        lastEditedBy: actor.userId,
        updatedAt: sql`now()`,
      })
      .where(eq(skills.id, id));
  } catch (err) {
    rethrowUnique(err, patch.name ?? row.name);
  }
  return { ok: true, skill: (await getSkillView(actor, id))!, before: row };
}

export async function deleteSkill(
  actor: SkillActor,
  id: string,
): Promise<{ ok: true; before: SkillRow } | { ok: false; reason: "not_found" | "forbidden" }> {
  if (!isUuid(id)) return { ok: false, reason: "not_found" };
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, id), inOrg(actor.orgId)));
  if (!row || !canSee(actor, row)) return { ok: false, reason: "not_found" };
  if (!canEdit(actor, row)) return { ok: false, reason: "forbidden" };
  await db.delete(skills).where(eq(skills.id, id));
  return { ok: true, before: row };
}
