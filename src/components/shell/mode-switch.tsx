"use client";

import { usePathname, useRouter } from "next/navigation";
import { MessagesSquare, ShieldCheck } from "lucide-react";
import { useSession } from "@/components/session/session-provider";
import { ADMIN_HOME, CHAT_HOME, isAdminPath } from "@/lib/routes";

/**
 * The mode island: a circular control pinned to the bottom-right that flips
 * between admin mode and chat mode — the same mental model as a light/dark
 * toggle. Admins land in admin mode (see `app/page.tsx`) and use this to reach
 * the chat, so it is the only switch between the two halves of the app.
 *
 * Gated on `actorIsAdmin`, not `isAdmin`: an admin impersonating a regular user
 * must keep the way back to the panel.
 *
 * DESIGN.md note: the circle is a deliberate exception to "buttons are 4px" —
 * Devis asked for a round toggle island. Everything else stays design-true
 * (floating-panel surface, hairline border, no shadow, mono-weight icon).
 */
export function ModeSwitch() {
  const { user } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  if (!user.actorIsAdmin) return null;

  const inAdmin = isAdminPath(pathname);
  const target = inAdmin ? CHAT_HOME : ADMIN_HOME;
  const label = inAdmin ? "Chat mode" : "Admin mode";
  const Icon = inAdmin ? MessagesSquare : ShieldCheck;

  return (
    <div className="group/mode fixed bottom-5 right-5 z-50 flex items-center gap-2">
      <span
        aria-hidden
        className="pointer-events-none rounded-md border border-border bg-slate-hearth px-2.5 py-1 text-body-sm text-pale-stone opacity-0 transition-opacity group-focus-within/mode:opacity-100 group-hover/mode:opacity-100"
      >
        {label}
      </span>
      <button
        type="button"
        onClick={() => router.push(target)}
        title={`Switch to ${label.toLowerCase()}`}
        aria-label={`Switch to ${label.toLowerCase()}`}
        className="flex size-11 items-center justify-center rounded-full border border-input bg-slate-hearth text-pale-stone transition-colors hover:bg-iron-veil hover:text-warm-off-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Icon className="size-[18px]" />
      </button>
    </div>
  );
}
