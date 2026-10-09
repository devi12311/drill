"use client";

import { usePathname } from "next/navigation";
import { MessagesSquare, ShieldCheck } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { useGuardedPush, useIsMac, useShortcut } from "@/components/shell/shortcuts";
import type { SessionUser } from "@/lib/auth/me";
import { ADMIN_HOME, CHAT_HOME, isAdminPath } from "@/lib/routes";
import { SHORTCUTS, comboText } from "@/lib/shortcuts";

/**
 * Who sees the island. Anything else pinned to the bottom-right corner (the
 * composer, the skill builder's footer) clears room for it on the same rule.
 */
export function showsModeSwitch(user: Pick<SessionUser, "actorIsAdmin" | "isOrgAdmin">): boolean {
  return user.actorIsAdmin || user.isOrgAdmin;
}

/**
 * The mode island: a circular control pinned to the bottom-right that flips
 * between admin mode and chat mode — the same mental model as a light/dark
 * toggle. Admins land in admin mode (see `app/page.tsx`) and use this to reach
 * the chat, so it is the only switch between the two halves of the app.
 *
 * Shown to anyone the console admits: platform admins (`actorIsAdmin`, not
 * `isAdmin` — an admin impersonating a regular user must keep the way back) and
 * the owners/admins of the active org (`isOrgAdmin`).
 *
 * Ctrl+K (⌘K on macOS) flips the mode too — same gate, same target as the button.
 * Both ask first when unsaved work would be lost (`useGuardedPush`).
 *
 * DESIGN.md note: the circle is a deliberate exception to "buttons are 4px" —
 * Devis asked for a round toggle island. Everything else stays design-true
 * (floating-panel surface, hairline border, no shadow, mono-weight icon).
 */
export function ModeSwitch() {
  const { user } = useSession();
  const pathname = usePathname();
  const push = useGuardedPush();
  const mac = useIsMac();
  const allowed = showsModeSwitch(user);
  const inAdmin = isAdminPath(pathname);
  const target = inAdmin ? CHAT_HOME : ADMIN_HOME;
  // Overrides the browser's own Ctrl+K (focus the search bar) while Drill has focus.
  useShortcut(SHORTCUTS.modeSwitch.keys, () => push(target), allowed);

  if (!allowed) return null;

  const label = inAdmin ? "Chat mode" : "Admin mode";
  const combo = comboText(SHORTCUTS.modeSwitch.keys, mac);
  const Icon = inAdmin ? MessagesSquare : ShieldCheck;

  return (
    <div className="group/mode fixed bottom-5 right-5 z-50 flex items-center gap-2">
      <span
        aria-hidden
        className="pointer-events-none rounded-md border border-border bg-slate-hearth px-2.5 py-1 text-body-sm text-pale-stone opacity-0 transition-opacity group-focus-within/mode:opacity-100 group-hover/mode:opacity-100"
      >
        {label} <span className="font-mono text-bone-gray">{combo}</span>
      </span>
      <button
        type="button"
        onClick={() => push(target)}
        title={`Switch to ${label.toLowerCase()} (${combo})`}
        aria-label={`Switch to ${label.toLowerCase()}`}
        className="flex size-11 items-center justify-center rounded-full border border-input bg-slate-hearth text-pale-stone transition-colors hover:bg-iron-veil hover:text-warm-off-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-[18px]" />
      </button>
    </div>
  );
}
