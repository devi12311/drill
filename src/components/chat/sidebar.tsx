"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronDown, Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BrandMark } from "@/components/shell/brand-mark";
import { SideNavLink } from "@/components/shell/side-nav-link";
import { SidebarUserFooter } from "@/components/shell/sidebar-user-footer";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useSession } from "@/components/session/session-provider";
import { useGuardedPush, useIsMac, useNavShortcuts, useShortcut } from "@/components/shell/shortcuts";
import { confirmLeave } from "@/components/ui/use-leave-guard";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import { CHAT_HOME } from "@/lib/routes";
import { SHORTCUTS, comboText } from "@/lib/shortcuts";
import { isInvestigating, type ConversationSummary } from "@/lib/chat/types";
import {
  WORKSPACE_JUMPS,
  WORKSPACE_NAV,
  chatUrl,
  isNavActive,
  writeChatUrl,
} from "@/lib/workspace/nav";

/**
 * One dot per row, most urgent first: something the user must act on outranks
 * "resolved". Traffic colours, not gold — DESIGN.md keeps gold inside code.
 */
function activityDot(conv: ConversationSummary): { className: string; title: string } | null {
  switch (conv.activity) {
    case "queued":
    case "running":
      return { className: "animate-pulse bg-traffic-yellow", title: "Investigating" };
    case "awaiting_approval":
      return { className: "bg-traffic-yellow", title: "Waiting for your approval" };
    case "failed":
    case "cancelled":
      return { className: "bg-traffic-red", title: "Stopped — open it to resume" };
  }
  return conv.status === "resolved"
    ? { className: "bg-traffic-green", title: "Resolved" }
    : null;
}

function shortDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * On the chat page a conversation link changes only the URL (the pane follows
 * `?c=`), skipping a navigation; elsewhere it is an ordinary link — which also
 * lets the skill editor's unsaved-changes guard catch it, and middle-click work.
 */
function onChatClick(onChat: boolean, conversationId: string | null) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onChat || e.defaultPrevented) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    writeChatUrl(conversationId, "push");
  };
}

/**
 * The workspace sidebar, rendered once by the `(workspace)` layout so it stays
 * put across chat, Resolutions and Skills. All of it reads the
 * workspace context; nothing is threaded through a page.
 */
export function Sidebar() {
  const {
    agents,
    activeAgentId,
    selectAgent,
    openAgents,
    conversations,
    listError,
    deleteConversation,
  } = useWorkspace();
  const { user } = useSession();
  const pathname = usePathname();
  const onChat = pathname === CHAT_HOME;
  const params = useSearchParams();
  // A row is "open" only on the chat page; elsewhere none is highlighted.
  const openId = onChat ? params.get("c") : null;
  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? null;
  const push = useGuardedPush();
  const mac = useIsMac();

  /** Open a conversation (null: a new one) the way its sidebar link would. */
  function openChat(conversationId: string | null) {
    if (!onChat) return push(chatUrl(conversationId));
    if (!confirmLeave()) return;
    writeChatUrl(conversationId, "push");
    // Keep the newly open row in view once it is highlighted.
    requestAnimationFrame(() =>
      document.querySelector("[data-recent] [data-active]")?.scrollIntoView({ block: "nearest" }),
    );
  }

  useNavShortcuts(WORKSPACE_JUMPS);
  useShortcut(SHORTCUTS.newInvestigation.keys, () => openChat(null), !!activeAgent);
  // Alt+↑/↓ steps through Recent (Slack's conversation keys); from no open
  // conversation, ↓ opens the newest and ↑ the oldest.
  useShortcut(
    [SHORTCUTS.prevConversation.keys, SHORTCUTS.nextConversation.keys],
    (_e, keys) => {
      const at = conversations.findIndex((c) => c.id === openId);
      const step = keys === SHORTCUTS.nextConversation.keys ? 1 : -1;
      const next = at < 0 ? (step > 0 ? 0 : conversations.length - 1) : at + step;
      const conv = conversations[next];
      if (conv) openChat(conv.id);
    },
    conversations.length > 0,
  );

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <BrandMark className="px-5 pb-4 pt-5" />

      <div className="space-y-2 px-3">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-sm border border-input px-3 py-2 text-left hover:bg-smoke-charcoal">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                activeAgent ? "bg-traffic-green" : "bg-traffic-yellow",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-body-sm text-warm-off-white">
              {activeAgent?.name ?? "No agent selected"}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-bone-gray" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[232px]">
            {agents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                onSelect={() => selectAgent(agent.id)}
                className={cn(agent.id === activeAgentId && "bg-smoke-charcoal")}
              >
                <div className="min-w-0">
                  <div className="truncate text-body-sm">{agent.name}</div>
                  <div className="truncate font-mono text-[11px] text-bone-gray">
                    {agent.url}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
            {agents.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={openAgents}>
              <Settings2 className="size-4" />
              {user.isOrgAdmin ? "Manage agents" : "View agents"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {activeAgent ? (
          <Button asChild variant="secondary" className="w-full justify-start gap-2">
            <Link
              href={CHAT_HOME}
              onClick={onChatClick(onChat, null)}
              title={`New investigation (${comboText(SHORTCUTS.newInvestigation.keys, mac)})`}
            >
              <Plus className="size-4" />
              New investigation
            </Link>
          </Button>
        ) : (
          <Button variant="secondary" className="w-full justify-start gap-2" disabled>
            <Plus className="size-4" />
            New investigation
          </Button>
        )}
      </div>

      <nav aria-label="Workspace" className="mt-4 space-y-0.5 px-3">
        {/* Admin lives behind the mode island (bottom-right), not here. */}
        {WORKSPACE_NAV.map((item) => (
          <SideNavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={item.icon}
            active={isNavActive(item, pathname)}
          />
        ))}
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        <div className="text-caption-tracked px-2 uppercase text-bone-gray">
          Recent
        </div>
        {listError ? (
          <div className="px-2 py-3 text-body-sm text-bone-gray">{listError}</div>
        ) : conversations.length === 0 ? (
          <div className="px-2 py-3 text-body-sm text-bone-gray">
            {activeAgent
              ? "No investigations yet."
              : "Add a Holmes agent to get started."}
          </div>
        ) : (
          <div data-recent className="mt-2 space-y-0.5">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center gap-2 rounded-sm px-2 py-2 hover:bg-smoke-charcoal/50",
                  openId === conv.id && "bg-iron-veil hover:bg-iron-veil",
                )}
                data-active={openId === conv.id ? "" : undefined}
              >
                <Link
                  href={chatUrl(conv.id)}
                  onClick={onChatClick(onChat, conv.id)}
                  aria-current={openId === conv.id ? "page" : undefined}
                  className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <div className="flex items-center gap-1.5">
                    {(() => {
                      const dot = activityDot(conv);
                      return (
                        dot && (
                          <span
                            title={dot.title}
                            className={cn(
                              "size-1.5 shrink-0 rounded-full",
                              dot.className,
                            )}
                          />
                        )
                      );
                    })()}
                    <span className="truncate text-body-sm text-warm-off-white/90 group-data-[active]:font-medium group-data-[active]:text-warm-off-white">
                      {conv.title}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-bone-gray group-hover:text-pale-stone group-data-[active]:text-pale-stone">
                    {shortDate(conv.updatedAt)} · {conv.model}
                  </div>
                </Link>
                <ConfirmButton
                  label="Delete conversation"
                  title="Delete this investigation?"
                  description={
                    isInvestigating(conv)
                      ? "Holmes is still working on it — deleting stops the investigation and removes the whole conversation. This cannot be undone."
                      : "The whole conversation is removed. A resolution artifact made from it stays in Resolutions. This cannot be undone."
                  }
                  confirmLabel="Delete"
                  destructive
                  variant="ghost"
                  size="icon-xs"
                  className="hidden shrink-0 text-pale-stone hover:text-traffic-red focus-visible:inline-flex group-hover:inline-flex group-focus-within:inline-flex"
                  onConfirm={() => deleteConversation(conv.id)}
                >
                  <Trash2 className="size-3.5" />
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </div>

      <SidebarUserFooter />
    </aside>
  );
}
