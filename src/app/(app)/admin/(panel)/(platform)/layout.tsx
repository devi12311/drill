import { notFound } from "next/navigation";
import { getAdminActor } from "@/lib/auth/session";

/**
 * The platform-only sections (every user, the full audit trail, every org). The
 * console itself also admits org owners/admins, so these need their own gate;
 * their API routes check `getAdminActor()` too. A 404, not a redirect: to an org
 * admin these pages do not exist.
 */
export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getAdminActor())) notFound();
  return children;
}
