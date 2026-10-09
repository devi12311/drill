import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { revokeShareLink } from "@/lib/db/share-queries";

type Context = { params: Promise<{ id: string }> };

/**
 * DELETE /api/share-links/[id] — revoke (its creator or an org admin). Stops new
 * imports only: copies already made belong to the orgs that made them.
 */
export async function DELETE(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  if (!(await revokeShareLink(ctx, id)))
    return Response.json({ error: "Share link not found" }, { status: 404 });
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "share.link.revoked",
    metadata: { linkId: id },
  });
  return Response.json({ ok: true });
}
