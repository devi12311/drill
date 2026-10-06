import { forbidden, getAuthContext, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { revokeInvite } from "@/lib/db/org-queries";
import { isUuid } from "@/lib/uuid";

type Context = { params: Promise<{ id: string }> };

/** DELETE — revoke a pending invitation; its link stops working at once. */
export async function DELETE(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  const { id } = await context.params;
  if (!isUuid(id) || !(await revokeInvite(ctx.orgId, id))) {
    return Response.json({ error: "Invite not found" }, { status: 404 });
  }
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "org.invite.revoked",
    metadata: { inviteId: id },
  });
  return Response.json({ ok: true });
}
