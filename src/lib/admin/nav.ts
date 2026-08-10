import {
  Activity,
  DollarSign,
  LayoutDashboard,
  ScrollText,
  Server,
  Users,
  type LucideIcon,
} from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the href exactly instead of by prefix (needed for `/admin` itself). */
  exact?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/**
 * The admin panel's information architecture — the single source of truth for
 * the sidebar AND the topbar breadcrumb. Adding a menu means adding one entry
 * here; nothing else needs to know about it.
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
      },
      { href: "/admin/cost", label: "Cost & usage", icon: DollarSign },
      { href: "/admin/activity", label: "Activity", icon: Activity },
    ],
  },
  {
    label: "People & access",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/audit", label: "Audit", icon: ScrollText },
    ],
  },
  {
    label: "Infrastructure",
    items: [{ href: "/admin/agents", label: "Agent health", icon: Server }],
  },
];

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
