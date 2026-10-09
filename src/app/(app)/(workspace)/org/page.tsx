import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getAnswerStyle, listMembers, listPendingInvites } from "@/lib/db/org-queries";
import { listShareLinks } from "@/lib/db/share-queries";
import { OrgSettings } from "@/components/orgs/org-settings";

export const metadata: Metadata = { title: "Organization · Drill" };

/**
 * The active org: its name, who is in it, (org admins) invitations and answer
 * style, and live share links — all of them for an admin, a member's own
 * otherwise. Read on the server so the page arrives filled; the client
 * refreshes it after a change.
 */
export default async function OrgPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const [members, invites, answerStyle, shareLinks] = await Promise.all([
    listMembers(ctx.orgId),
    ctx.isOrgAdmin ? listPendingInvites(ctx.orgId) : Promise.resolve([]),
    ctx.isOrgAdmin ? getAnswerStyle(ctx.orgId) : Promise.resolve(null),
    listShareLinks(ctx),
  ]);
  return (
    <OrgSettings
      members={members}
      invites={invites}
      answerStyle={answerStyle}
      shareLinks={shareLinks}
    />
  );
}
