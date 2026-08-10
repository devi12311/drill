import type { UserRole } from "./jwt";

/**
 * Usernames granted admin via the ADMIN_USERNAMES env allowlist
 * (comma-separated, case-insensitive). The DB `users.role` column is the
 * source of truth, but login/register reconcile it against this list so the
 * first admin is bootstrapped with zero manual SQL (docs/DECISIONS.md).
 */
export function adminAllowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_USERNAMES ?? "")
      .split(",")
      .map((u) => u.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAllowlistedAdmin(username: string): boolean {
  return adminAllowlist().has(username.trim().toLowerCase());
}

/** Role a user should have given their stored role and the env allowlist. */
export function resolveRole(username: string, storedRole: UserRole): UserRole {
  return isAllowlistedAdmin(username) ? "admin" : storedRole;
}
