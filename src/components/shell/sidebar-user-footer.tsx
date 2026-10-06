"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronsUpDown, LogOut, Plus, Users } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSession } from "@/components/session/session-provider";
import { NewOrgDialog } from "@/components/orgs/new-org-dialog";
import { switchOrg } from "@/components/orgs/org-actions";
import { ORG_ROLE_LABEL } from "@/lib/orgs/types";

/**
 * Signed-in identity, the org switcher and logout, pinned to the bottom of a
 * sidebar. The org list comes with the server-rendered session, so opening the
 * menu costs no request. Switching is unavailable while impersonating: the org
 * is the impersonated user's, and every write is blocked anyway.
 */
export function SidebarUserFooter() {
  const { user, logout } = useSession();
  const pathname = usePathname();
  const [creating, setCreating] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const identity = (
    <div className="min-w-0 flex-1 text-left">
      <div className="truncate text-body-sm text-warm-off-white">
        {user.org.name}
      </div>
      <div className="truncate font-mono text-[11px] text-bone-gray">
        {user.impersonating ? `viewing as ${user.username}` : user.username}
      </div>
    </div>
  );

  return (
    <div className="border-t border-sidebar-border px-3 py-3">
      <div className="flex items-center gap-1">
        {user.impersonating ? (
          <div className="min-w-0 flex-1 px-2">{identity}</div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Switch organization"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1 hover:bg-smoke-charcoal"
            >
              {identity}
              <ChevronsUpDown className="size-3.5 shrink-0 text-bone-gray" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" className="w-[232px]">
              <DropdownMenuLabel className="text-caption-tracked uppercase text-bone-gray">
                Organizations
              </DropdownMenuLabel>
              {user.orgs.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onSelect={() => {
                    if (org.id === user.org.id) return;
                    setSwitchError(null);
                    switchOrg(org.id, pathname).catch((err: Error) =>
                      setSwitchError(err.message),
                    );
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body-sm">{org.name}</div>
                    <div className="text-[11px] text-bone-gray">
                      {ORG_ROLE_LABEL[org.role]}
                    </div>
                  </div>
                  {org.id === user.org.id && (
                    <Check className="size-3.5 text-pale-stone" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/org">
                  <Users className="size-4" />
                  Members & invites
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setCreating(true)}>
                <Plus className="size-4" />
                New organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          aria-label="Log out"
          onClick={logout}
          className="shrink-0 rounded-sm p-1.5 text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white"
        >
          <LogOut className="size-4" />
        </button>
      </div>
      {switchError && (
        <p role="alert" className="px-2 pt-1 text-[12px] text-traffic-red">
          Could not switch: {switchError}
        </p>
      )}
      <NewOrgDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
