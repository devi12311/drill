import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { setActiveOrg, setSession } from "@/lib/auth/session";
import { resolveRole } from "@/lib/auth/admin";
import { writeAudit } from "@/lib/db/admin-queries";
import { claimInvite, createOrgWithOwner } from "@/lib/db/org-queries";

/** Rolls the sign-up back: an invitee whose link died gets no stray account. */
class InviteGoneError extends Error {}

/**
 * POST /api/auth/register — body { username, password, invite? }. With an invite
 * token the account joins that org instead of getting one of its own: someone
 * signing up from a teammate's link never wanted a personal org.
 */
export async function POST(request: Request) {
  let body: { username?: string; password?: string; invite?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const invite = typeof body.invite === "string" && body.invite ? body.invite : null;
  if (username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) {
    return Response.json(
      { error: "Username: at least 3 characters (letters, digits, . _ -)" },
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, username));
  if (existing.length > 0) {
    return Response.json({ error: "Username already taken" }, { status: 409 });
  }

  // Env allowlist may grant admin at first sign-up (bootstraps the first admin).
  const role = resolveRole(username, "user");
  const passwordHash = await hashPassword(password);
  // Every account starts in exactly one org: the inviting one, else its own as
  // owner. One transaction, so there is never a user with no org.
  let created;
  try {
    created = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ username, passwordHash, role })
        .returning({ id: users.id, username: users.username, role: users.role });
      if (!invite) {
        await createOrgWithOwner(`${username}'s org`, user.id, tx);
        return { user, joined: null };
      }
      const joined = await claimInvite(invite, user.id, tx);
      if (!joined) throw new InviteGoneError();
      return { user, joined };
    });
  } catch (err) {
    if (!(err instanceof InviteGoneError)) throw err;
    return Response.json(
      { error: "This invitation has expired, been used, or been revoked" },
      { status: 410 },
    );
  }

  const { user, joined } = created;
  await setSession(user);
  if (joined) {
    await setActiveOrg(joined.orgId);
    await writeAudit({
      actorId: user.id,
      orgId: joined.orgId,
      action: "org.invite.accepted",
      metadata: { role: joined.role, signup: true },
    });
  }
  return Response.json({ id: user.id, username: user.username, role: user.role });
}
