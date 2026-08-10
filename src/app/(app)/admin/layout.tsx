import { redirect } from "next/navigation";
import { getAdminActor } from "@/lib/auth/session";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminTopBar } from "@/components/admin/admin-topbar";

/**
 * Admin shell: persistent sidebar + breadcrumb bar + scrolling content column.
 *
 * The `getAdminActor()` gate is belt to the proxy's edge guard and the
 * per-route `requireAdmin` checks (braces) — and it reads the *real* session,
 * so an admin impersonating a user keeps access to the panel.
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
        <main className="min-h-0 flex-1 overflow-y-auto">
          {/* pb-20 keeps the last row clear of the mode island. */}
          <div className="mx-auto w-full max-w-[1100px] px-8 pb-20 pt-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
