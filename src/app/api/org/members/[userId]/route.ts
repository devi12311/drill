import { forbidden, getAuthContext, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  changeMembership,
  getMemberRole,
  LastOwnerError,
} from "@/lib/db/org-queries";
import {
  assignableRoles,
  canManageMember,
  ORG_ROLES,
  type OrgRole,
} from "@/lib/orgs/types";
import { isUuid } from "@/lib/uuid";

type Context = { params: Promise<{ userId: string }> };

const notFound = () =>
  Response.json({ error: "Member not found" }, { status: 404 });

/** PATCH — body { role }. Change another member's role within your own authority. */
export async function PATCH(request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { userId } = await context.params;
  const role = (await request.json().catch(() => null))?.role as OrgRole;
  if (!ORG_ROLES.includes(role)) {
    return Response.json({ error: "Unknown role" }, { status: 400 });
  }
  const current = isUuid(userId) ? await getMemberRole(ctx.orgId, userId) : null;
  if (!current) return notFound();
  if (
    !canManageMember(ctx.orgRole, current) ||
    !assignableRoles(ctx.orgRole).includes(role)
  ) {
    return forbidden();
  }
  return apply(ctx, userId, role, () =>
    writeAudit({
      actorId: ctx.userId,
      orgId: ctx.orgId,
      action: "org.member.role",
      targetUserId: userId,
      metadata: { from: current, to: role },
    }),
  );
}

/** DELETE — remove a member, or (your own id) leave the org. */
export async function DELETE(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { userId } = await context.params;
  const leaving = userId === ctx.userId;
  const current = isUuid(userId) ? await getMemberRole(ctx.orgId, userId) : null;
  if (!current) return notFound();
  if (!leaving && !canManageMember(ctx.orgRole, current)) return forbidden();
  return apply(ctx, userId, null, () =>
    writeAudit({
      actorId: ctx.userId,
      orgId: ctx.orgId,
      action: leaving ? "org.member.left" : "org.member.removed",
      targetUserId: leaving ? null : userId,
      metadata: { role: current },
    }),
  );
}

async function apply(
  ctx: { orgId: string },
  userId: string,
  role: OrgRole | null,
  audit: () => Promise<void>,
) {
  try {
    if (!(await changeMembership(ctx.orgId, userId, role))) return notFound();
  } catch (err) {
    if (err instanceof LastOwnerError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
  await audit();
  return Response.json({ ok: true });
}
