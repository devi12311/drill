import "server-only";
import { getAuthContext, unauthorized, type AuthContext } from "@/lib/auth/session";
import type { Membership } from "@/lib/db/org-queries";
import { findLiveShareLink, type OpenedShareLink } from "@/lib/db/share-queries";

export const SHARE_GONE_MESSAGE = "This link has expired, been revoked, or is not for you";

export const shareGone = () => Response.json({ error: SHARE_GONE_MESSAGE }, { status: 410 });

/**
 * The gate both recipient actions (import, decline) pass: signed in, the link
 * still live and meant for them, and `orgId` one of their orgs. A Response is
 * the refusal to return as-is.
 */
export async function openShareFor(
  token: string,
  orgId: unknown,
): Promise<
  | { ctx: AuthContext; link: OpenedShareLink; target: Membership }
  | Response
> {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const link = await findLiveShareLink(token, ctx.memberships.map((m) => m.orgId));
  if (!link) return shareGone();
  const target = ctx.memberships.find((m) => m.orgId === orgId);
  if (!target)
    return Response.json({ error: "Pick one of your organizations" }, { status: 400 });
  return { ctx, link, target };
}
