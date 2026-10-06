import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listMembers, listPendingInvites } from "@/lib/db/org-queries";
import { OrgSettings } from "@/components/orgs/org-settings";

export const metadata: Metadata = { title: "Organization · Drill" };

/**
 * The active org: its name, who is in it, and (org admins) invitations. Read on
 * the server so the page arrives filled; the client refreshes it after a change.
 */
export default async function OrgPage() {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const [members, invites] = await Promise.all([
    listMembers(ctx.orgId),
    ctx.isOrgAdmin ? listPendingInvites(ctx.orgId) : Promise.resolve([]),
  ]);
  return <OrgSettings members={members} invites={invites} />;
}
