/** Canonical entry points for the app's two modes. Framework-agnostic so both
 *  server components and client components can import them. */
export const ADMIN_HOME = "/admin";
export const CHAT_HOME = "/chat";

/** True for any route inside the admin panel. */
export function isAdminPath(pathname: string) {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}

/**
 * Machine-to-machine endpoints. These carry no session cookie — the caller is
 * the scheduler (a Kubernetes CronJob), authenticated by a shared secret inside
 * the handler instead. Kept here next to `isAdminPath` so the edge guard in
 * proxy.ts cannot drift from the app's idea of what is machine-facing.
 */
export const INTERNAL_API_PREFIX = "/api/internal/";

export function isInternalApiPath(pathname: string) {
  return pathname.startsWith(INTERNAL_API_PREFIX);
}

export const LOGIN_PATH = "/login";

/** Where a signed-in user with no org at all lands (left or removed from the last one). */
export const NO_ORG_PATH = "/no-org";

/**
 * A post-login destination, if it is a path on THIS site. `//evil.com` and
 * `/\evil.com` are protocol-relative to a browser, so only a single leading
 * slash qualifies — anything else would make the login page an open redirect.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return null;
  }
  return raw;
}

/** The login URL that brings the user back to `path` afterwards. */
export function loginUrl(path: string): string {
  return `${LOGIN_PATH}?next=${encodeURIComponent(path)}`;
}
