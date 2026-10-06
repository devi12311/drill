import { forbidden, getAuthContext, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { createInvite, listPendingInvites } from "@/lib/db/org-queries";
import { assignableRoles, type OrgRole } from "@/lib/orgs/types";

const LABEL_MAX = 80;

/** GET /api/org/invites — the active org's unused, unexpired invitations. */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  return Response.json(await listPendingInvites(ctx.orgId));
}

/**
 * POST /api/org/invites — body { role, label? }. Returns the raw token once; the
 * client turns it into a link on its own origin, so no Host header is trusted.
 */
export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  const body = (await request.json().catch(() => null)) ?? {};
  const role = body.role as OrgRole;
  if (!assignableRoles(ctx.orgRole).includes(role)) {
    return Response.json(
      { error: "You cannot invite someone with that role" },
      { status: 403 },
    );
  }
  const label =
    typeof body.label === "string" && body.label.trim()
      ? body.label.trim().slice(0, LABEL_MAX)
      : null;
  const invite = await createInvite({
    orgId: ctx.orgId,
    role,
    label,
    createdBy: ctx.userId,
  });
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "org.invite.created",
    metadata: { inviteId: invite.id, role, label },
  });
  return Response.json(invite, { status: 201 });
}
