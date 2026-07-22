import { jwtVerify, SignJWT } from "jose";

// Shared by route handlers and proxy.ts (edge) — jose works in both runtimes.

const SESSION_DURATION = "7d";

export interface SessionPayload {
  sub: string; // user id
  username: string;
}

function secret(): Uint8Array {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(value);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ username: payload.username })
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
    return { sub: payload.sub, username: String(payload.username ?? "") };
  } catch {
    return null;
  }
}
