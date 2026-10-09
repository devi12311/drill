import {
  Activity,
  Building2,
  DollarSign,
  LayoutDashboard,
  Radar,
  ScrollText,
  Server,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { NavJump } from "@/lib/shortcuts";

export interface AdminNavItem extends NavJump {
  icon: LucideIcon;
  /** Match the href exactly instead of by prefix (needed for `/admin` itself). */
  exact?: boolean;
  /**
   * Platform admins only. Everything else is an ORG section — it shows the active
   * org's data to its owners/admins and to platform admins alike.
   */
  platform?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/**
 * The admin panel's information architecture — the single source of truth for
 * the sidebar, the topbar breadcrumb and the `g` chords. Adding a menu means
 * adding one entry here; nothing else needs to know about it.
 */
export const ADMIN_NAV: AdminNavGroup[] = [
  {
    label: "Insights",
    items: [
      {
        href: "/admin",
        label: "Overview",
        icon: LayoutDashboard,
        exact: true,
        shortcut: "d",
      },
      { href: "/admin/cost", label: "Cost & usage", icon: DollarSign, shortcut: "c" },
      { href: "/admin/activity", label: "Activity", icon: Activity, shortcut: "a" },
      { href: "/admin/audit", label: "Audit", icon: ScrollText, shortcut: "l" },
    ],
  },
  {
    label: "Infrastructure",
    items: [
      { href: "/admin/monitoring", label: "Monitoring", icon: Radar, shortcut: "m" },
      { href: "/admin/agents", label: "Agent health", icon: Server, shortcut: "h" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/admin/orgs", label: "Organizations", icon: Building2, platform: true, shortcut: "o" },
      { href: "/admin/users", label: "Users", icon: Users, platform: true, shortcut: "u" },
    ],
  },
];

/** The nav as one viewer may see it: platform items only for platform admins. */
export function visibleAdminNav(isPlatformAdmin: boolean): AdminNavGroup[] {
  return ADMIN_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => isPlatformAdmin || !item.platform),
  })).filter((group) => group.items.length > 0);
}

/** Does `pathname` sit under this nav item? */
export function isNavItemActive(item: AdminNavItem, pathname: string) {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * The nav item owning `pathname` — the most specific match wins, so
 * `/admin/users/<id>` resolves to Users rather than to Overview.
 */
export function findNavItem(pathname: string): AdminNavItem | null {
  const matches = ADMIN_NAV.flatMap((group) => group.items).filter((item) =>
    isNavItemActive(item, pathname),
  );
  return (
    matches.sort((a, b) => b.href.length - a.href.length)[0] ?? null
  );
}
