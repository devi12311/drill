import { redirect } from "next/navigation";
import { getAdminActor } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopBar } from "@/components/admin/admin-topbar";

/**
 * Admin SHELL: persistent sidebar + breadcrumb bar + the region pages fill.
 *
 * The `getAdminActor()` gate is belt to the proxy's edge guard and the
 * per-route `requireAdmin` checks (braces) — and it reads the *real* session,
 * so an admin impersonating a user keeps access to the panel.
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
  if (!(await getAdminActor())) redirect("/");

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
