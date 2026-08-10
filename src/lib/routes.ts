/** Canonical entry points for the app's two modes. Framework-agnostic so both
 *  server components and client components can import them. */
export const ADMIN_HOME = "/admin";
export const CHAT_HOME = "/chat";

/** True for any route inside the admin panel. */
export function isAdminPath(pathname: string) {
  return pathname === ADMIN_HOME || pathname.startsWith(`${ADMIN_HOME}/`);
}
