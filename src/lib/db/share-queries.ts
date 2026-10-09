import "server-only";
import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./index";
import {
  organizations,
  orgMemberships,
  resolutionArtifacts,
  shareLinkRedemptions,
  shareLinks,
  skills,
  users,
} from "./schema";
import { draftValues, type ManagerScope } from "./queries";
import { rethrowUnique } from "./skill-queries";
import { isOrgAdmin, type OrgRole } from "@/lib/orgs/types";
import { isUuid } from "@/lib/uuid";
import { hashLinkToken, newLinkToken } from "@/lib/tokens";
import type {
  ImportedFrom,
  RedemptionStatus,
  ShareAudience,
  ShareKind,
  ShareLinkView,
  SharePayload,
} from "@/lib/share/types";

/**
 * Share links (docs/DECISIONS.md — "Share links"). The only path by which a row
 * of one org reaches another: a snapshot the sharing org chose to export, copied
 * in by a person of the receiving org. Nothing here reads across the boundary at
 * any other time — the receiving side keeps text (`ImportedFrom`), not ids.
 */

const live = () =>
  and(isNull(shareLinks.revokedAt), gt(shareLinks.expiresAt, sql`now()`));

const DAY_MS = 24 * 60 * 60 * 1000;

/** Returns the raw token — the only time it exists outside the link. */
export async function createShareLink(
  actor: ManagerScope,
  input: {
    kind: ShareKind;
    audience: ShareAudience;
    sourceId: string;
    title: string;
    payload: SharePayload;
    expiresInDays: number;
  },
): Promise<{ id: string; token: string }> {
  const { token, tokenHash } = newLinkToken();
  const [row] = await db
    .insert(shareLinks)
    .values({
      orgId: actor.orgId,
      kind: input.kind,
      audience: input.audience,
      sourceId: input.sourceId,
      title: input.title,
      payload: input.payload,
      tokenHash,
      createdBy: actor.userId,
      expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
    })
    .returning({ id: shareLinks.id });
  return { id: row.id, token };
}

/**
 * The org's live links — every one for an org admin, a member's own otherwise —
 * optionally for one shared item. Who imported is only named on `org` links.
 */
export async function listShareLinks(
  actor: ManagerScope,
  sourceId?: string,
): Promise<ShareLinkView[]> {
  if (sourceId !== undefined && !isUuid(sourceId)) return [];
  const creator = alias(users, "share_creator");
  const links = await db
    .select({
      id: shareLinks.id,
      kind: shareLinks.kind,
      audience: shareLinks.audience,
      title: shareLinks.title,
      sourceId: shareLinks.sourceId,
      createdByName: creator.username,
      createdAt: shareLinks.createdAt,
      expiresAt: shareLinks.expiresAt,
      creatorRole: orgMemberships.role,
    })
    .from(shareLinks)
    .leftJoin(creator, eq(creator.id, shareLinks.createdBy))
    .leftJoin(orgMemberships, creatorMembership())
    .where(
      and(
        eq(shareLinks.orgId, actor.orgId),
        live(),
        actor.isOrgAdmin ? undefined : eq(shareLinks.createdBy, actor.userId),
        sourceId ? eq(shareLinks.sourceId, sourceId) : undefined,
      ),
    )
    .orderBy(desc(shareLinks.createdAt))
    // Same rule as opening one: a link its creator could no longer make is dead.
    .then((rows) => rows.filter((r) => creatorMayShare(r.audience, r.creatorRole)));
  if (links.length === 0) return [];

  const redemptions = await db
    .select({
      linkId: shareLinkRedemptions.linkId,
      status: shareLinkRedemptions.status,
      username: users.username,
    })
    .from(shareLinkRedemptions)
    .innerJoin(users, eq(users.id, shareLinkRedemptions.userId))
    .where(inArray(shareLinkRedemptions.linkId, links.map((l) => l.id)));

  return links.map((link) => {
    const mine = redemptions.filter((r) => r.linkId === link.id);
    return {
      id: link.id,
      kind: link.kind,
      audience: link.audience,
      title: link.title,
      sourceId: link.sourceId,
      createdByName: link.createdByName,
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      imported: mine.filter((r) => r.status === "imported").length,
      declined: mine.filter((r) => r.status === "declined").length,
      people:
        link.audience === "org"
          ? mine.map((r) => ({ username: r.username, status: r.status }))
          : null,
    };
  });
}

/** The creator or an org admin. Idempotent on an already-dead link: false. */
export async function revokeShareLink(actor: ManagerScope, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const rows = await db
    .update(shareLinks)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(shareLinks.id, id),
        eq(shareLinks.orgId, actor.orgId),
        live(),
        actor.isOrgAdmin ? undefined : eq(shareLinks.createdBy, actor.userId),
      ),
    )
    .returning({ id: shareLinks.id });
  return rows.length > 0;
}

/** A link as the person who opened it sees it. */
export interface OpenedShareLink {
  id: string;
  orgId: string;
  orgName: string;
  kind: ShareKind;
  audience: ShareAudience;
  sourceId: string | null;
  payload: SharePayload;
  author: string | null;
  createdAt: Date;
}

/**
 * A link the viewer may use, or null — and null for every reason alike (unknown,
 * expired, revoked, not for them, its creator no longer allowed to share it), so
 * a link reveals nothing about itself to someone it is not for.
 *
 * A link lives only while its creator could still create it: a member while they
 * are in the org, an `any` link while they are its admin. Demoting or removing
 * someone thereby retires what they handed out.
 */
export async function findLiveShareLink(
  token: string,
  viewerOrgIds: readonly string[],
): Promise<OpenedShareLink | null> {
  const [row] = await db
    .select({
      link: shareLinks,
      orgName: organizations.name,
      author: users.username,
      creatorRole: orgMemberships.role,
    })
    .from(shareLinks)
    .innerJoin(organizations, eq(organizations.id, shareLinks.orgId))
    .leftJoin(users, eq(users.id, shareLinks.createdBy))
    .leftJoin(orgMemberships, creatorMembership())
    .where(and(eq(shareLinks.tokenHash, hashLinkToken(token)), live()));
  if (!row || !creatorMayShare(row.link.audience, row.creatorRole)) return null;
  if (row.link.audience === "org" && !viewerOrgIds.includes(row.link.orgId)) return null;
  const { link } = row;
  return {
    id: link.id,
    orgId: link.orgId,
    orgName: row.orgName,
    kind: link.kind,
    audience: link.audience,
    sourceId: link.sourceId,
    payload: link.payload,
    author: row.author,
    createdAt: link.createdAt,
  };
}

/** Joins the link creator's membership in the link's org (none once they left). */
const creatorMembership = () =>
  and(eq(orgMemberships.orgId, shareLinks.orgId), eq(orgMemberships.userId, shareLinks.createdBy));

function creatorMayShare(audience: ShareAudience, role: OrgRole | null): boolean {
  if (!role) return false;
  return audience === "org" || isOrgAdmin(role);
}

export interface Redemption {
  targetOrgId: string;
  status: RedemptionStatus;
  importedId: string | null;
  /** The imported row is still in the target org (false once someone deleted it). */
  copyExists: boolean;
  updatedAt: Date;
}

/**
 * Whether the row a redemption imported is still in its target org. "Once per
 * org" guards against duplicates — a copy that was deleted duplicates nothing,
 * so deleting it frees the person to import again. The redemption row stays as
 * history (and in the sharer's counts).
 */
const copyExists = (kind: ShareKind) => {
  const table = kind === "skill" ? skills : resolutionArtifacts;
  return sql<boolean>`exists (select 1 from ${table} where ${table.id} = ${shareLinkRedemptions.importedId} and ${table.orgId} = ${shareLinkRedemptions.targetOrgId})`;
};

/** What this person already did with the link, per org. */
export async function listRedemptions(
  link: Pick<OpenedShareLink, "id" | "kind">,
  userId: string,
): Promise<Redemption[]> {
  return db
    .select({
      targetOrgId: shareLinkRedemptions.targetOrgId,
      status: shareLinkRedemptions.status,
      importedId: shareLinkRedemptions.importedId,
      copyExists: copyExists(link.kind),
      updatedAt: shareLinkRedemptions.updatedAt,
    })
    .from(shareLinkRedemptions)
    .where(and(eq(shareLinkRedemptions.linkId, link.id), eq(shareLinkRedemptions.userId, userId)));
}

export class ShareGone extends Error {}
export class AlreadyImported extends Error {}

/**
 * Copy the (recipient-edited, already validated) draft into `targetOrgId`. One
 * transaction: the link row is locked live, so a revoke either lands before the
 * import (410) or after it — never in between. A skill arrives private, so
 * making it steer the whole org stays an admin's separate step (DECISIONS 112).
 */
export async function importShare(
  link: OpenedShareLink,
  importer: { userId: string; targetOrgId: string },
  payload: SharePayload,
): Promise<{ id: string }> {
  const importedFrom: ImportedFrom = {
    linkId: link.id,
    orgName: link.orgName,
    author: link.author,
    sharedAt: link.createdAt.toISOString(),
  };
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: shareLinks.id })
      .from(shareLinks)
      .where(and(eq(shareLinks.id, link.id), live()))
      .for("update");
    if (!locked) throw new ShareGone();

    const match = and(
      eq(shareLinkRedemptions.linkId, link.id),
      eq(shareLinkRedemptions.userId, importer.userId),
      eq(shareLinkRedemptions.targetOrgId, importer.targetOrgId),
    );
    const [previous] = await tx
      .select({ status: shareLinkRedemptions.status, copyExists: copyExists(link.kind) })
      .from(shareLinkRedemptions)
      .where(match);
    if (previous?.status === "imported" && previous.copyExists) throw new AlreadyImported();

    let id: string;
    if (payload.kind === "skill") {
      try {
        [{ id }] = await tx
          .insert(skills)
          .values({
            ...payload.draft,
            orgId: importer.targetOrgId,
            importedFrom,
            createdBy: importer.userId,
            lastEditedBy: importer.userId,
          })
          .returning({ id: skills.id });
      } catch (err) {
        rethrowUnique(err, payload.draft.name);
      }
    } else {
      [{ id }] = await tx
        .insert(resolutionArtifacts)
        .values({
          ...draftValues(payload.draft),
          orgId: importer.targetOrgId,
          importedFrom,
          createdBy: importer.userId,
        })
        .returning({ id: resolutionArtifacts.id });
    }

    await tx
      .insert(shareLinkRedemptions)
      .values({ linkId: link.id, ...importer, status: "imported", importedId: id })
      .onConflictDoUpdate({
        target: [
          shareLinkRedemptions.linkId,
          shareLinkRedemptions.userId,
          shareLinkRedemptions.targetOrgId,
        ],
        set: { status: "imported", importedId: id, updatedAt: new Date() },
      });
    return { id };
  });
}

/** "Not now" — recorded so the sharer sees it, and never over an import. */
export async function declineShare(
  linkId: string,
  importer: { userId: string; targetOrgId: string },
): Promise<void> {
  await db
    .insert(shareLinkRedemptions)
    .values({ linkId, ...importer, status: "declined" })
    .onConflictDoUpdate({
      target: [
        shareLinkRedemptions.linkId,
        shareLinkRedemptions.userId,
        shareLinkRedemptions.targetOrgId,
      ],
      set: { status: "declined", updatedAt: new Date() },
      setWhere: ne(shareLinkRedemptions.status, "imported"),
    });
}

/**
 * Whether the shared item is already within the viewer's reach in the org that
 * shared it — then the page points at it instead of offering a duplicate. A
 * resolution is readable by every member; a skill only when shared or theirs.
 */
export async function sourceInReach(
  link: OpenedShareLink,
  userId: string,
  viewerOrgIds: readonly string[],
): Promise<boolean> {
  if (!link.sourceId || !viewerOrgIds.includes(link.orgId)) return false;
  const [row] =
    link.kind === "resolution"
      ? await db
          .select({ id: resolutionArtifacts.id })
          .from(resolutionArtifacts)
          .where(and(eq(resolutionArtifacts.id, link.sourceId), eq(resolutionArtifacts.orgId, link.orgId)))
      : await db
          .select({ id: skills.id })
          .from(skills)
          .where(
            and(
              eq(skills.id, link.sourceId),
              eq(skills.orgId, link.orgId),
              or(eq(skills.visibility, "shared"), eq(skills.createdBy, userId)),
            ),
          );
  return row !== undefined;
}

/** Whether `name` is already used in `orgId` — the review page warns before Import would fail. */
export async function skillNameTaken(orgId: string, name: string): Promise<boolean> {
  const [row] = await db
    .select({ id: skills.id })
    .from(skills)
    .where(and(eq(skills.orgId, orgId), eq(skills.name, name)));
  return row !== undefined;
}
