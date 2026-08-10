"use client";

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A sidebar navigation row — the one place the app defines what a nav item
 * looks like (4px radius per DESIGN.md, icon in bone-gray, label lifting to
 * warm-off-white on hover/active). Used by both sidebars.
 */
export function SideNavLink({
  href,
  label,
  icon: Icon,
  active = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-body-sm text-pale-stone transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white",
        active && "bg-smoke-charcoal text-warm-off-white",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          active ? "text-warm-off-white" : "text-bone-gray",
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}
