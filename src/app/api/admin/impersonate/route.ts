import {
  getAdminActor,
  getAuthUser,
  setImpersonation,
  clearImpersonation,
  forbidden,
} from "@/lib/auth/session";
import { getUserById } from "@/lib/db/queries";
import { writeAudit } from "@/lib/db/admin-queries";

/** Begin impersonating a user. Body: { userId }. */
export async function POST(request: Request) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();

  let body: { userId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const targetUserId = body.userId?.trim();
  if (!targetUserId) {
    return Response.json({ error: "userId is required" }, { status: 400 });
  }
  if (targetUserId === actor.id) {
    return Response.json(
      { error: "You cannot impersonate yourself" },
      { status: 400 },
    );
  }

  const target = await getUserById(targetUserId);
  if (!target) {
    return Response.json({ error: "User not found" }, { status: 404 });
  }

  await setImpersonation({ targetUserId: target.id, actorId: actor.id });
  await writeAudit({
    actorId: actor.id,
    action: "impersonate.start",
    targetUserId: target.id,
    metadata: { targetUsername: target.username },
  });
  return Response.json({
    ok: true,
    target: { id: target.id, username: target.username },
  });
}

/** Stop impersonating (clear the impersonation cookie). */
export async function DELETE() {
  const actor = await getAdminActor();
  if (!actor) return forbidden();

  // The effective user reveals who was being impersonated (for the audit trail).
  const effective = await getAuthUser();
  await clearImpersonation();
  if (effective?.impersonatorId === actor.id) {
    await writeAudit({
      actorId: actor.id,
      action: "impersonate.stop",
      targetUserId: effective.id,
      metadata: { targetUsername: effective.username },
    });
  }
  return Response.json({ ok: true });
}
