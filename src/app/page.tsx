import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { ADMIN_HOME, CHAT_HOME } from "@/lib/routes";

/**
 * `/` is a router, not a page: admins land in the admin panel, everyone else in
 * the chat. The mode island (bottom-right) is how an admin crosses over.
 *
 * While impersonating, `getSessionUser()` reports the *impersonated* user — so
 * "impersonate" correctly drops the admin into that user's chat.
 */
export default async function RootRoute() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  redirect(user.isAdmin ? ADMIN_HOME : CHAT_HOME);
}
