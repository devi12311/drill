import "server-only";
import { cookies } from "next/headers";
import { signSession, verifySession } from "./jwt";
import { SESSION_COOKIE } from "./session-cookie";
import { userExists } from "@/lib/db/queries";

export { SESSION_COOKIE };

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // mirror JWT expiry

export interface AuthUser {
  id: string;
  username: string;
}

export async function setSession(user: AuthUser): Promise<void> {
  const token = await signSession({ sub: user.id, username: user.username });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Opt-in (COOKIE_SECURE=1) rather than tied to NODE_ENV: Drill often runs
    // plain-HTTP behind a TLS-terminating ingress, where a Secure cookie set
    // by the app would never come back.
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Authenticated user for route handlers, or null. */
export async function getAuthUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  try {
    // A valid JWT can outlive its user row (e.g. dev DB wipe) — without this
    // check every user-scoped insert dies on an FK violation instead of a 401.
    if (!(await userExists(payload.sub))) return null;
  } catch {
    // DB unreachable: trust the JWT so auth-only paths keep working; the
    // DB-dependent route will surface its own 503.
  }
  return { id: payload.sub, username: payload.username };
}

/** 401 JSON response for unauthenticated API access. */
export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
