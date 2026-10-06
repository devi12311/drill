import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { db, type DbExecutor } from "./index";
import { orgInvites, orgMemberships, organizations, users } from "./schema";
import type { OrgInviteView, OrgMemberView, OrgRole } from "@/lib/orgs/types";

export interface Membership {
  orgId: string;
  orgName: string;
  role: OrgRole;
}

/** The orgs a user belongs to, oldest membership first (the default active org). */
export async function listMemberships(userId: string): Promise<Membership[]> {
  return db
    .select({
      orgId: orgMemberships.orgId,
      orgName: organizations.name,
      role: orgMemberships.role,
    })
    .from(orgMemberships)
    .innerJoin(organizations, eq(organizations.id, orgMemberships.orgId))
    .where(eq(orgMemberships.userId, userId))
    .orderBy(asc(orgMemberships.createdAt));
}

/** A new org with its first member as owner — what signing up creates. */
export async function createOrgWithOwner(
  name: string,
  userId: string,
  tx: DbExecutor = db,
): Promise<string> {
  const [org] = await tx
    .insert(organizations)
    .values({ name })
    .returning({ id: organizations.id });
  await tx
    .insert(orgMemberships)
    .values({ orgId: org.id, userId, role: "owner" });
  return org.id;
}

export async function renameOrg(orgId: string, name: string): Promise<void> {
  await db.update(organizations).set({ name }).where(eq(organizations.id, orgId));
}

// ---- Members ----

export async function listMembers(orgId: string): Promise<OrgMemberView[]> {
  const rows = await db
    .select({
      userId: orgMemberships.userId,
      username: users.username,
      role: orgMemberships.role,
      joinedAt: orgMemberships.createdAt,
    })
    .from(orgMemberships)
    .innerJoin(users, eq(users.id, orgMemberships.userId))
    .where(eq(orgMemberships.orgId, orgId))
    .orderBy(asc(orgMemberships.createdAt));
  return rows.map((r) => ({ ...r, joinedAt: r.joinedAt.toISOString() }));
}

export async function getMemberRole(
  orgId: string,
  userId: string,
): Promise<OrgRole | null> {
  const [row] = await db
    .select({ role: orgMemberships.role })
    .from(orgMemberships)
    .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId)));
  return row?.role ?? null;
}

/** Thrown when a change would leave an org with nobody able to run it. */
export class LastOwnerError extends Error {
  constructor() {
    super("An organization needs at least one owner — make someone else owner first");
  }
}

/**
 * Change a member's role, or remove them (`role: null`). The last-owner rule is
 * checked inside the transaction with the owners locked, so two owners demoting
 * each other at the same moment cannot both succeed.
 */
export async function changeMembership(
  orgId: string,
  userId: string,
  role: OrgRole | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owners = await tx
      .select({ userId: orgMemberships.userId })
      .from(orgMemberships)
      .where(and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.role, "owner")))
      .for("update");
    const isOwner = owners.some((o) => o.userId === userId);
    if (isOwner && role !== "owner" && owners.length === 1) throw new LastOwnerError();
    const match = and(eq(orgMemberships.orgId, orgId), eq(orgMemberships.userId, userId));
    const rows = role
      ? await tx.update(orgMemberships).set({ role }).where(match).returning({ id: orgMemberships.userId })
      : await tx.delete(orgMemberships).where(match).returning({ id: orgMemberships.userId });
    return rows.length > 0;
  });
}

// ---- Invites ----

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

const pending = () =>
  and(isNull(orgInvites.acceptedAt), gt(orgInvites.expiresAt, sql`now()`));

/** Returns the raw token — the only time it exists outside the link. */
export async function createInvite(input: {
  orgId: string;
  role: OrgRole;
  label: string | null;
  createdBy: string;
}): Promise<{ id: string; token: string }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await db
    .insert(orgInvites)
    .values({
      ...input,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    })
    .returning({ id: orgInvites.id });
  return { id: row.id, token };
}

export async function listPendingInvites(orgId: string): Promise<OrgInviteView[]> {
  const rows = await db
    .select({
      id: orgInvites.id,
      role: orgInvites.role,
      label: orgInvites.label,
      createdByName: users.username,
      expiresAt: orgInvites.expiresAt,
    })
    .from(orgInvites)
    .leftJoin(users, eq(users.id, orgInvites.createdBy))
    .where(and(eq(orgInvites.orgId, orgId), pending()))
    .orderBy(asc(orgInvites.createdAt));
  return rows.map((r) => ({ ...r, expiresAt: r.expiresAt.toISOString() }));
}

export async function revokeInvite(orgId: string, inviteId: string): Promise<boolean> {
  const rows = await db
    .delete(orgInvites)
    .where(and(eq(orgInvites.id, inviteId), eq(orgInvites.orgId, orgId)))
    .returning({ id: orgInvites.id });
  return rows.length > 0;
}

export interface InvitePreview {
  orgId: string;
  orgName: string;
  role: OrgRole;
  invitedBy: string | null;
}

/** A still-usable invitation, for the page that offers to accept it. */
export async function findPendingInvite(token: string): Promise<InvitePreview | null> {
  const [row] = await db
    .select({
      orgId: orgInvites.orgId,
      orgName: organizations.name,
      role: orgInvites.role,
      invitedBy: users.username,
    })
    .from(orgInvites)
    .innerJoin(organizations, eq(organizations.id, orgInvites.orgId))
    .leftJoin(users, eq(users.id, orgInvites.createdBy))
    .where(and(eq(orgInvites.tokenHash, hashToken(token)), pending()));
  return row ?? null;
}

/**
 * Spend an invitation. The claim is one conditional UPDATE, so a link opened in
 * two tabs (or forwarded to two people) adds exactly one member. Someone already
 * in the org keeps their current role and leaves the invite unspent.
 */
export async function acceptInvite(
  token: string,
  userId: string,
): Promise<{ orgId: string; role: OrgRole; alreadyMember: boolean } | null> {
  const invite = await findPendingInvite(token);
  if (!invite) return null;
  if (await getMemberRole(invite.orgId, userId)) {
    return { orgId: invite.orgId, role: invite.role, alreadyMember: true };
  }
  return db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(orgInvites)
      .set({ acceptedBy: userId, acceptedAt: new Date() })
      .where(and(eq(orgInvites.tokenHash, hashToken(token)), pending()))
      .returning({ orgId: orgInvites.orgId, role: orgInvites.role });
    if (!claimed) return null;
    await tx
      .insert(orgMemberships)
      .values({ orgId: claimed.orgId, userId, role: claimed.role })
      .onConflictDoNothing();
    return { ...claimed, alreadyMember: false };
  });
}
