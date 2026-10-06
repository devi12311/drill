import { redirect } from "next/navigation";
import { getConsoleContext } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopBar } from "@/components/admin/admin-topbar";

/**
 * Admin SHELL: persistent sidebar + breadcrumb bar + the region pages fill.
 *
 * The `getConsoleContext()` gate admits platform admins and the owners/admins of
 * the active org; every route handler re-checks (and platform-only sections check
 * `isPlatformAdmin` on top). It reads the *real* session, so an admin
 * impersonating a user keeps access to the panel.
 *
 * Page chrome (the centred reading column) is deliberately NOT here: it lives in
 * `(panel)/layout.tsx`, which every ordinary admin page sits under. Sections
 * that need a different frame — `monitoring/`, with its own navigation column —
 * are siblings of that group and bring their own.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await getConsoleContext())) redirect("/");

  return (
    <div className="flex min-h-0 w-full flex-1">
      <AdminSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopBar />
        {children}
      </div>
    </div>
  );
}
