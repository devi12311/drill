import { BookMarked, ListChecks, type LucideIcon } from "lucide-react";
import { CHAT_HOME } from "@/lib/routes";
import type { NavJump } from "@/lib/shortcuts";

export interface WorkspaceNavItem extends NavJump {
  /** The section's root; `isActive` matches it and everything under it. */
  href: string;
  icon: LucideIcon;
}

/**
 * The workspace's sections — the single source of truth for the chat sidebar's
 * navigation, as `ADMIN_NAV` is for the admin one. Chat has no entry: the
 * "New investigation" button and the Recent list above it are the way in. The
 * org page has none either: it is reached from the org menu in the sidebar
 * footer, beside the switcher, where org settings are expected to live.
 */
export const WORKSPACE_NAV: WorkspaceNavItem[] = [
  { href: "/resolutions", label: "Resolutions", icon: BookMarked, shortcut: "r" },
  { href: "/skills", label: "Skills", icon: ListChecks, shortcut: "s" },
];

/**
 * Everywhere a `g` chord reaches in the workspace: the nav, plus the two places
 * the sidebar reaches another way (chat via "New investigation", the org page
 * via the footer menu).
 */
export const WORKSPACE_JUMPS: NavJump[] = [
  { href: CHAT_HOME, label: "Chat", shortcut: "c" },
  ...WORKSPACE_NAV,
  { href: "/org", label: "Organization", shortcut: "o" },
];

export function isNavActive(item: WorkspaceNavItem, pathname: string): boolean {
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** `/chat` or `/chat?c=<id>` — the one way a conversation URL is spelled. */
export function chatUrl(conversationId: string | null): string {
  return conversationId
    ? `${CHAT_HOME}?c=${encodeURIComponent(conversationId)}`
    : CHAT_HOME;
}

/** A new chat with `skill` picked in the composer, ready for its inputs. */
export function skillRunUrl(skillName: string): string {
  return `${CHAT_HOME}?skill=${encodeURIComponent(skillName)}`;
}

/**
 * Change the open conversation without a navigation. Only valid on the chat
 * page: Next syncs the History API with `useSearchParams`, which is what the
 * chat pane reads, so no server round trip happens and the pane follows.
 */
export function writeChatUrl(conversationId: string | null, mode: "push" | "replace") {
  const url = chatUrl(conversationId);
  if (window.location.pathname + window.location.search === url) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}
