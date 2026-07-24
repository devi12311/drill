import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";
import { resolveRole } from "@/lib/auth/admin";

export async function POST(request: Request) {
  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const username = body.username?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.username, username));
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return Response.json(
      { error: "Invalid username or password" },
      { status: 401 },
    );
  }

  // Reconcile role against the ADMIN_USERNAMES allowlist (env is authoritative
  // for bootstrapping admins), persisting any change so the DB stays truthful.
  const role = resolveRole(user.username, user.role);
  if (role !== user.role) {
    await db.update(users).set({ role }).where(eq(users.id, user.id));
  }

  await setSession({ id: user.id, username: user.username, role });
  return Response.json({ id: user.id, username: user.username, role });
}
