"use client";

import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/shell/brand-mark";
import { SideNavLink } from "@/components/shell/side-nav-link";
import { SidebarUserFooter } from "@/components/shell/sidebar-user-footer";
import { ADMIN_NAV, isNavItemActive } from "@/lib/admin/nav";

/**
 * The admin panel's primary navigation: a persistent grouped sidebar, matching
 * the chat sidebar's frame (260px, Smoked Onyx band, hairline right border) so
 * switching modes reads as the same product.
 *
 * Menus come from `ADMIN_NAV` — add there, not here.
 */
export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <BrandMark className="px-5 pb-4 pt-5" eyebrow="Admin console" />

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {ADMIN_NAV.map((group) => (
          <div key={group.label} className="mt-4 first:mt-0">
            <div className="text-caption-tracked px-3 pb-1.5 uppercase text-bone-gray">
              {group.label}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <SideNavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isNavItemActive(item, pathname)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <SidebarUserFooter />
    </aside>
  );
}
