"use client";

import Link from "next/link";
import {
  BookMarked,
  ChevronDown,
  LogOut,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  username,
  agents,
  activeAgentId,
  onSelectAgent,
  onManageAgents,
  conversations,
  activeId,
  onNewChat,
  onSelect,
  onDelete,
  onLogout,
  listError,
}: {
  username: string | null;
  agents: AgentSummary[];
  activeAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onManageAgents: () => void;
  conversations: ConversationSummary[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onLogout: () => void;
  listError: string | null;
}) {
  const activeAgent = agents.find((a) => a.id === activeAgentId) ?? null;

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="px-5 pb-4 pt-5">
        <div className="font-mono text-body font-medium tracking-[0.2em] text-warm-off-white">
          DRILL
        </div>
        <div className="text-caption-tracked mt-1 uppercase text-bone-gray">
          Root cause, on demand
        </div>
      </div>

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

        <Link
          href="/resolutions"
          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-body-sm text-pale-stone hover:bg-smoke-charcoal hover:text-warm-off-white"
        >
          <BookMarked className="size-4 text-bone-gray" />
          Resolutions
        </Link>
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

      <div className="flex items-center justify-between border-t border-sidebar-border px-5 py-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[12px] text-pale-stone">
            {username ?? "…"}
          </div>
          <div className="text-caption-tracked uppercase text-bone-gray">
            Signed in
          </div>
        </div>
        <button
          type="button"
          aria-label="Log out"
          onClick={onLogout}
          className="rounded-sm p-1.5 text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  );
}
