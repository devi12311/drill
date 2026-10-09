import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listMembers, listPendingInvites } from "@/lib/db/org-queries";
import { listShareLinks } from "@/lib/db/share-queries";
import { OrgSettings } from "@/components/orgs/org-settings";

export const metadata: Metadata = { title: "Organization · Drill" };

/**
 * The active org: its name, who is in it, (org admins) invitations, and live
 * share links — all of them for an admin, a member's own otherwise. Read on
 * the server so the page arrives filled; the client refreshes it after a change.
 */
export default async function OrgPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const [members, invites, shareLinks] = await Promise.all([
    listMembers(ctx.orgId),
    ctx.isOrgAdmin ? listPendingInvites(ctx.orgId) : Promise.resolve([]),
    listShareLinks(ctx),
  ]);
  return <OrgSettings members={members} invites={invites} shareLinks={shareLinks} />;
}
