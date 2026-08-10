/**
 * The client-safe shape of "who am I" — the single contract shared by
 * `GET /api/auth/me`, the server-rendered `(app)` shell and `useSession()`.
 *
 * Deliberately NOT in `session.ts`: that module is `server-only`, and client
 * components need this type. Keep it free of server imports.
 */
export interface SessionUser {
  id: string;
  username: string;
  role: "user" | "admin";
  /** Role of the *effective* user — false when an admin impersonates a user. */
  isAdmin: boolean;
  /** True while an admin is viewing the app as another user (read-only). */
  impersonating: boolean;
  impersonatorUsername: string | null;
  /**
   * True when the *real* logged-in actor is an admin, even while impersonating
   * a non-admin. This — not `isAdmin` — gates admin-only chrome such as the
   * mode switch, so an impersonating admin never loses their way back.
   */
  actorIsAdmin: boolean;
}
