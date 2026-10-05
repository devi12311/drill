import "server-only";
import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { db, isUniqueViolation } from "./index";
import { skills, users } from "./schema";
import type {
  SkillDraft,
  SkillView,
  SkillVisibility,
} from "@/lib/skills/types";

type SkillRow = typeof skills.$inferSelect;

/** A malformed id would be a Postgres cast error; to a caller it is just absent. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who is asking — the effective user, so impersonation sees what they see. */
export interface SkillActor {
  id: string;
  isAdmin: boolean;
}

export function skillActor(user: { id: string; role: string }): SkillActor {
  return { id: user.id, isAdmin: user.role === "admin" };
}

/**
 * A private skill is its author's alone; a shared one changes every user's
 * investigations, so once shared only an admin may edit it — otherwise sharing
 * would be a review the author could undo by editing afterwards.
 */
function canSee(actor: SkillActor, row: SkillRow): boolean {
  return actor.isAdmin || row.visibility === "shared" || row.createdBy === actor.id;
}

function canEdit(actor: SkillActor, row: SkillRow): boolean {
  if (actor.isAdmin) return true;
  return row.visibility === "private" && row.createdBy === actor.id;
}

/** Skills that reach this user's investigations: their own plus shared ones. */
const usableBy = (userId: string) =>
  or(eq(skills.visibility, "shared"), eq(skills.createdBy, userId));

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
 * The library page. Admins see every skill, other users' private ones included —
 * they moderate what gets shared, and can already impersonate anyone.
 */
export async function listSkills(actor: SkillActor): Promise<SkillView[]> {
  const query = withAuthor();
  const rows = await (actor.isAdmin ? query : query.where(usableBy(actor.id)))
    .orderBy(desc(skills.visibility), asc(skills.name));
  return rows.map(({ row, author }) => toView(actor, row, author));
}

export async function getSkillView(
  actor: SkillActor,
  id: string,
): Promise<SkillView | null> {
  if (!UUID.test(id)) return null;
  const [found] = await withAuthor().where(eq(skills.id, id));
  if (!found) return null;
  const { row, author } = found;
  if (!canSee(actor, row)) return null;
  return toView(actor, row, author);
}

/**
 * What an investigation may use, for the catalog and always-on blocks. Admins get
 * the same set as anyone — another user's private skill never steers theirs.
 */
export async function usableSkills(userId: string): Promise<SkillRow[]> {
  return db
    .select()
    .from(skills)
    .where(usableBy(userId))
    // Shared first: when the catalog is capped, the reviewed ones survive.
    .orderBy(desc(skills.visibility), desc(skills.updatedAt));
}

/** One usable skill by name (what the model passes) or id (what the UI sends). */
export async function getUsableSkill(
  userId: string,
  ref: { name: string } | { id: string },
): Promise<SkillRow | null> {
  if ("id" in ref && !UUID.test(ref.id)) return null;
  const match =
    "name" in ref ? eq(skills.name, ref.name) : eq(skills.id, ref.id);
  const [row] = await db
    .select()
    .from(skills)
    .where(and(match, usableBy(userId)));
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

/** New skills always start private; sharing is a separate, admin-only step. */
export async function createSkill(
  actor: SkillActor,
  draft: SkillDraft,
): Promise<SkillView> {
  try {
    const [row] = await db
      .insert(skills)
      .values({ ...draft, createdBy: actor.id, lastEditedBy: actor.id })
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
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const [row] = await db.select().from(skills).where(eq(skills.id, id));
  if (!row || !canSee(actor, row)) return { ok: false, reason: "not_found" };
  if (!canEdit(actor, row)) return { ok: false, reason: "forbidden" };
  if ((patch.visibility !== undefined || patch.alwaysOn !== undefined) && !actor.isAdmin)
    return { ok: false, reason: "forbidden", message: "Only an admin can share a skill or make it always-on" };

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
        lastEditedBy: actor.id,
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
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  const [row] = await db.select().from(skills).where(eq(skills.id, id));
  if (!row || !canSee(actor, row)) return { ok: false, reason: "not_found" };
  if (!canEdit(actor, row)) return { ok: false, reason: "forbidden" };
  await db.delete(skills).where(eq(skills.id, id));
  return { ok: true, before: row };
}
