import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
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
  const [user] = await db
    .insert(users)
    .values({ username, passwordHash: await hashPassword(password), role })
    .returning({ id: users.id, username: users.username, role: users.role });

  await setSession(user);
  return Response.json({ id: user.id, username: user.username, role: user.role });
}
