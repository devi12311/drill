"use client";

import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { findNavItem } from "@/lib/admin/nav";

/**
 * Thin location band above the admin content column: "Admin › <section>".
 * Derived from `ADMIN_NAV`, so a new menu gets its breadcrumb for free. Kept
 * separate from the page's own title block (`AdminPageHeader`) — the bar says
 * where you are, the header says what this page is.
 */
export function AdminTopBar() {
  const pathname = usePathname();
  const current = findNavItem(pathname);

  return (
    <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border px-8 text-body-sm text-bone-gray">
      <span className="text-caption-tracked uppercase">Admin</span>
      {current && (
        <>
          <ChevronRight className="size-3.5" />
          <span className="text-pale-stone">{current.label}</span>
        </>
      )}
    </div>
  );
}
