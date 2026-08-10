import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { SessionProvider } from "@/components/session/session-provider";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";
import { ModeSwitch } from "@/components/shell/mode-switch";

/**
 * Shell for every authenticated route (chat, resolutions, admin). It resolves
 * the session ONCE on the server and hydrates it into `SessionProvider`, so
 * client components read the user from context instead of each fetching
 * `/api/auth/me` on mount.
 *
 * It is also the last line of the auth chain: `src/proxy.ts` only verifies the
 * JWT at the edge, so a token that outlived its user row (dev DB wipe) gets
 * through — here `getSessionUser()` returns null and we bounce to /login.
 *
 * `/login` and `/register` sit OUTSIDE this group and are unaffected.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <SessionProvider user={user}>
      <ImpersonationBanner />
      {children}
      <ModeSwitch />
    </SessionProvider>
  );
}
