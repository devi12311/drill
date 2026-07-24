import "server-only";
import { cookies } from "next/headers";
import {
  signSession,
  signImpersonation,
  verifySession,
  verifyImpersonation,
  type UserRole,
} from "./jwt";
import { SESSION_COOKIE } from "./session-cookie";
import { IMPERSONATION_COOKIE } from "./impersonation-cookie";
import { getUserById } from "@/lib/db/queries";

export { SESSION_COOKIE };

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // mirror JWT expiry
const IMPERSONATION_MAX_AGE = 12 * 60 * 60; // mirror impersonation token expiry

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  /** Set only while impersonating: the real admin acting as this user. */
  impersonatorId?: string;
  impersonatorUsername?: string;
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // Opt-in (COOKIE_SECURE=1) rather than tied to NODE_ENV: Drill often runs
    // plain-HTTP behind a TLS-terminating ingress, where a Secure cookie set
    // by the app would never come back.
    secure: process.env.COOKIE_SECURE === "1",
    path: "/",
    maxAge,
  };
}

export async function setSession(user: {
  id: string;
  username: string;
  role: UserRole;
}): Promise<void> {
  const token = await signSession({
    sub: user.id,
    username: user.username,
    role: user.role,
  });
  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(COOKIE_MAX_AGE));
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  // Never leave a dangling impersonation cookie after logout.
  store.delete(IMPERSONATION_COOKIE);
}

/** Begin impersonating a target user (caller must have verified admin + target). */
export async function setImpersonation(opts: {
  targetUserId: string;
  actorId: string;
}): Promise<void> {
  const token = await signImpersonation(opts);
  const store = await cookies();
  store.set(IMPERSONATION_COOKIE, token, cookieOptions(IMPERSONATION_MAX_AGE));
}

export async function clearImpersonation(): Promise<void> {
  const store = await cookies();
  store.delete(IMPERSONATION_COOKIE);
}

/**
 * The real logged-in user (never the impersonated one), with role from the DB
 * (source of truth — a JWT role claim can be stale after a promote/demote).
 * On DB outage, trusts the JWT claim so auth-only paths keep working.
 */
async function getRealUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  try {
    const dbUser = await getUserById(payload.sub);
    // A valid JWT can outlive its user row (e.g. dev DB wipe) — without this
    // check every user-scoped insert dies on an FK violation instead of a 401.
    if (!dbUser) return null;
    return { id: dbUser.id, username: dbUser.username, role: dbUser.role };
  } catch {
    // DB unreachable: trust the JWT so auth-only paths keep working; the
    // DB-dependent route will surface its own 503.
    return { id: payload.sub, username: payload.username, role: payload.role };
  }
}

/**
 * Effective authenticated user for route handlers, or null. When a valid
 * impersonation cookie is present AND the real session user is currently an
 * admin AND the token's actor matches them, this returns the *impersonated*
 * user — so every existing user-scoped query renders that user's data with no
 * code changes. Otherwise it returns the real user.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const real = await getRealUser();
  if (!real) return null;

  const store = await cookies();
  const impToken = store.get(IMPERSONATION_COOKIE)?.value;
  if (impToken && real.role === "admin") {
    const decoded = await verifyImpersonation(impToken);
    // Re-check admin at read time + bind the token to this admin: a revoked
    // admin (or a mismatched actor) cannot impersonate.
    if (decoded && decoded.actor === real.id) {
      try {
        const target = await getUserById(decoded.sub);
        if (target) {
          return {
            id: target.id,
            username: target.username,
            role: target.role,
            impersonatorId: real.id,
            impersonatorUsername: real.username,
          };
        }
      } catch {
        // DB down: fall through to the real admin user.
      }
    }
  }
  return real;
}

/**
 * The real admin actor for /api/admin/* handlers — ignores impersonation and
 * returns the user only if they are currently an admin, else null.
 */
export async function getAdminActor(): Promise<AuthUser | null> {
  const real = await getRealUser();
  if (!real || real.role !== "admin") return null;
  return real;
}

/** 401 JSON response for unauthenticated API access. */
export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/** 403 JSON response for non-admin access to admin resources. */
export function forbidden(): Response {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}
