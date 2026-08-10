"use client";

import { LogOut } from "lucide-react";
import { useSession } from "@/components/session/session-provider";

/**
 * Signed-in identity + logout, pinned to the bottom of a sidebar. Reads the
 * session from context, so no sidebar has to thread `username`/`onLogout`
 * props down from a page.
 */
export function SidebarUserFooter() {
  const { user, logout } = useSession();

  return (
    <div className="flex items-center justify-between border-t border-sidebar-border px-5 py-3">
      <div className="min-w-0">
        <div className="truncate font-mono text-[12px] text-pale-stone">
          {user.username}
        </div>
        <div className="text-caption-tracked uppercase text-bone-gray">
          {user.impersonating
            ? "Viewing as"
            : user.isAdmin
              ? "Administrator"
              : "Signed in"}
        </div>
      </div>
      <button
        type="button"
        aria-label="Log out"
        onClick={logout}
        className="rounded-sm p-1.5 text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  );
}
