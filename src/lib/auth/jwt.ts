import { jwtVerify, SignJWT } from "jose";

// Shared by route handlers and proxy.ts (edge) — jose works in both runtimes.

const SESSION_DURATION = "7d";

export type UserRole = "user" | "admin";

export interface SessionPayload {
  sub: string; // user id
  username: string;
  role: UserRole;
}

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(SESSION_DURATION)
    .sign(secret());
}

export async function verifySession(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    // Sessions minted before roles existed carry no `role` claim → default
    // to the least-privileged "user".
    const role: UserRole = payload.role === "admin" ? "admin" : "user";
    return { sub: payload.sub, username: String(payload.username ?? ""), role };
  } catch {
    return null;
  }
}

/**
 * Verify + decode the impersonation token (a separate signed JWT). Returns the
 * target user id and the acting admin's id, or null.
 */
export async function verifyImpersonation(
  token: string,
): Promise<{ sub: string; actor: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub || typeof payload.actor !== "string") return null;
    return { sub: payload.sub, actor: payload.actor };
  } catch {
    return null;
  }
}

/** Sign a short-lived impersonation token binding target ← acting admin. */
export async function signImpersonation(opts: {
  targetUserId: string;
  actorId: string;
}): Promise<string> {
  return new SignJWT({ actor: opts.actorId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.targetUserId)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}
