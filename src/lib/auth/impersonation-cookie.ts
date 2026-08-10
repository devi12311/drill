/**
 * Cookie holding the impersonation token. Separate from SESSION_COOKIE so the
 * admin's real session is never overwritten — "stop impersonating" is a delete.
 * Its own file so the edge middleware (proxy.ts) can import it without pulling
 * in server-only code.
 */
export const IMPERSONATION_COOKIE = "drill_impersonate";
