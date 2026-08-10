"use client";

import { usePathname } from "next/navigation";
import { BookMarked, ChevronDown, Plus, Settings2, Trash2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { AgentSummary } from "@/components/agents/agents-dialog";

export interface ConversationSummary {
  id: string;
  title: string;
  model: string;
  status: "open" | "resolved";
  artifactId: string | null;
  updatedAt: string;
}

function shortDate(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function Sidebar({
  agents,
  activeAgentId,
  onSelectAgent,
  onManageAgents,
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
  listError,
}: {
  agents: AgentSummary[];
  activeAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onManageAgents: () => void;
  conversations: ConversationSummary[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  listError: string | null;
}) {
  const pathname = usePathname();
  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? null;

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
                onSelect={() => onSelectAgent(agent.id)}
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
            <DropdownMenuItem onSelect={onManageAgents}>
              <Settings2 className="size-4" />
              Manage agents
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="secondary"
          className="w-full justify-start gap-2"
          onClick={onNewChat}
          disabled={!activeAgent}
        >
          <Plus className="size-4" />
          New investigation
        </Button>

        {/* Admin lives behind the mode island (bottom-right), not here. */}
        <SideNavLink
          href="/resolutions"
          label="Resolutions"
          icon={BookMarked}
          active={pathname.startsWith("/resolutions")}
        />
      </div>

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
          <div className="mt-2 space-y-0.5">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={cn(
                  "group flex items-center gap-2 rounded-sm px-2 py-2 hover:bg-smoke-charcoal",
                  activeId === conv.id && "bg-smoke-charcoal",
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(conv.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-1.5">
                    {conv.status === "resolved" && (
                      <span
                        title="Resolved"
                        className="size-1.5 shrink-0 rounded-full bg-traffic-green"
                      />
                    )}
                    <span className="truncate text-body-sm text-pale-stone group-hover:text-warm-off-white">
                      {conv.title}
                    </span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-bone-gray">
                    {shortDate(conv.updatedAt)} · {conv.model}
                  </div>
                </button>
                <button
                  type="button"
                  aria-label="Delete conversation"
                  onClick={() => onDelete(conv.id)}
                  className="hidden shrink-0 rounded-sm p-1 text-bone-gray hover:text-traffic-red group-hover:block"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <SidebarUserFooter />
    </aside>
  );
}
