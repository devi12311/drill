import { getAuthUser, setActiveOrg, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { acceptInvite } from "@/lib/db/org-queries";

type Context = { params: Promise<{ token: string }> };

/**
 * POST /api/invites/[token] — join the org the link invites to, and switch to it.
 * The bare user, not an org context: the invitee may belong to no org yet.
 */
export async function POST(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { token } = await context.params;
  const result = await acceptInvite(token, user.id);
  if (!result) {
    return Response.json(
      { error: "This invitation has expired, been used, or been revoked" },
      { status: 410 },
    );
  }
  await setActiveOrg(result.orgId);
  if (!result.alreadyMember) {
    await writeAudit({
      actorId: user.id,
      orgId: result.orgId,
      action: "org.invite.accepted",
      metadata: { role: result.role },
    });
  }
  return Response.json({ orgId: result.orgId });
}
