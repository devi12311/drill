import { BookMarked, ListChecks, Users, type LucideIcon } from "lucide-react";
import { CHAT_HOME } from "@/lib/routes";

export interface WorkspaceNavItem {
  /** The section's root; `isActive` matches it and everything under it. */
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The workspace's sections — the single source of truth for the chat sidebar's
 * navigation, as `ADMIN_NAV` is for the admin one. Chat has no entry: the
 * "New investigation" button and the Recent list above it are the way in.
 */
export const WORKSPACE_NAV: WorkspaceNavItem[] = [
  { href: "/resolutions", label: "Resolutions", icon: BookMarked },
  { href: "/skills", label: "Skills", icon: ListChecks },
  { href: "/org", label: "Organization", icon: Users },
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
