"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Chat } from "@/components/chat/chat";
import { loadConversation } from "@/components/chat/conversation-api";
import {
  Sidebar,
  isInvestigating,
  type ConversationSummary,
} from "@/components/chat/sidebar";
import {
  AgentsDialog,
  type AgentSummary,
} from "@/components/agents/agents-dialog";
import type { ChatEntry } from "@/components/chat/messages";
import type { ConversationActivity, TurnSnapshot } from "@/lib/chat/types";

const AGENT_STORAGE_KEY = "drill.activeAgentId";
/** While anything is investigating, the list is re-read this often (its dots). */
const LIST_POLL_MS = 10_000;

/**
 * The open conversation lives in the URL (`/chat?c=<id>`), so a reload, a shared
 * link and the back button all land where the user was. Written with the
 * History API directly: the page is a client component and the param is read
 * once on load and on popstate, which is all `useSearchParams` would add.
 */
function conversationFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("c");
}

function writeUrl(id: string | null, mode: "push" | "replace") {
  const url = id ? `/chat?c=${encodeURIComponent(id)}` : "/chat";
  if (window.location.pathname + window.location.search === url) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

/** The tab title when something finished while the tab was in the background. */
function finishedTitle(activity: ConversationActivity): string {
  if (activity === "awaiting_approval") return "! Needs approval";
  if (activity === "failed" || activity === "cancelled")
    return "✕ Investigation stopped";
  return "✓ Answer ready";
}

export default function ChatWorkspace() {
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialEntries, setInitialEntries] = useState<ChatEntry[]>([]);
  const [initialTurn, setInitialTurn] = useState<TurnSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Chat remounts only when we intentionally switch context (new/select/agent).
  const [chatKey, setChatKey] = useState(0);

  const refreshAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const list = body as AgentSummary[];
      setAgents(list);
      setActiveAgentId((current) => {
        const stored =
          current ?? localStorage.getItem(AGENT_STORAGE_KEY) ?? null;
        if (stored && list.some((a) => a.id === stored)) return stored;
        return list[0]?.id ?? null;
      });
    } catch {
      // ignore; sidebar will show empty state
    } finally {
      setAgentsLoaded(true);
    }
  }, []);

  useEffect(() => {
    refreshAgents();
  }, [refreshAgents]);

  const refreshConversations = useCallback(async () => {
    if (!activeAgentId) {
      setConversations([]);
      return;
    }
    try {
      const res = await fetch(`/api/conversations?agent_id=${activeAgentId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setConversations(body);
      setListError(null);
    } catch (err) {
      setListError(
        err instanceof Error ? err.message : "Failed to load history",
      );
    }
  }, [activeAgentId]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  // The dots of running conversations change without this page doing anything.
  const anyInvestigating = conversations.some(isInvestigating);
  useEffect(() => {
    if (!anyInvestigating) return;
    const timer = setInterval(refreshConversations, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [anyInvestigating, refreshConversations]);

  // Tab title: "● Investigating" while anything runs; when one finishes with the
  // tab in the background, say how, until the user looks again.
  const baseTitle = useRef<string | null>(null);
  const lastActivity = useRef(new Map<string, ConversationActivity>());
  useEffect(() => {
    baseTitle.current ??= document.title;
    let finished: string | null = null;
    for (const conv of conversations) {
      const was = lastActivity.current.get(conv.id);
      if ((was === "queued" || was === "running") && !isInvestigating(conv))
        finished = finishedTitle(conv.activity);
    }
    lastActivity.current = new Map(conversations.map((c) => [c.id, c.activity]));
    if (anyInvestigating) document.title = `● Investigating — ${baseTitle.current}`;
    else if (finished && document.hidden)
      document.title = `${finished} — ${baseTitle.current}`;
    else if (!document.hidden) document.title = baseTitle.current;
  }, [conversations, anyInvestigating]);
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden && baseTitle.current && !document.title.startsWith("●"))
        document.title = baseTitle.current;
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      if (baseTitle.current) document.title = baseTitle.current;
    };
  }, []);

  const newChat = useCallback((url: "push" | "none" = "push") => {
    setActiveId(null);
    setInitialEntries([]);
    setInitialTurn(null);
    setLoadError(null);
    setChatKey((k) => k + 1);
    if (url === "push") writeUrl(null, "push");
  }, []);

  function selectAgent(id: string) {
    if (id === activeAgentId) return;
    localStorage.setItem(AGENT_STORAGE_KEY, id);
    setActiveAgentId(id);
    newChat();
  }

  /**
   * Open a conversation — from the sidebar, the URL, or the back button. A link
   * may point at another of the user's agents; the workspace switches to it.
   */
  const openConversation = useCallback(
    async (id: string, url: "push" | "replace" | "none") => {
      try {
        const loaded = await loadConversation(id);
        setActiveAgentId((current) => {
          if (current === loaded.agentId) return current;
          localStorage.setItem(AGENT_STORAGE_KEY, loaded.agentId);
          return loaded.agentId;
        });
        setActiveId(id);
        setInitialEntries(loaded.entries);
        setInitialTurn(loaded.turn);
        setLoadError(null);
        setChatKey((k) => k + 1);
        if (url !== "none") writeUrl(id, url);
      } catch (err) {
        // Shown in the chat pane — the Recent list stays usable.
        setLoadError(
          `Could not open that investigation: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        if (url === "replace") writeUrl(null, "replace");
      }
    },
    [],
  );

  // Land where the URL says on load (a reload, a shared link), and follow the
  // back/forward buttons after that. Opening needs no agent list: the
  // conversation names its own agent.
  useEffect(() => {
    const id = conversationFromUrl();
    // Its setState calls all run after an `await` (the fetch); the rule cannot
    // see through the call and flags it as synchronous.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) void openConversation(id, "replace");
    const onPop = () => {
      const id = conversationFromUrl();
      if (id) void openConversation(id, "none");
      else newChat("none");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openConversation, newChat]);

  function selectConversation(id: string) {
    if (id === activeId) return;
    void openConversation(id, "push");
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(
      () => null,
    );
    if (id === activeId) newChat();
    refreshConversations();
  }

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  return (
    <main className="flex min-h-0 w-full flex-1">
      <Sidebar
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={selectAgent}
        onManageAgents={() => setAgentsOpen(true)}
        conversations={conversations}
        activeId={activeId}
        onNewChat={() => newChat()}
        onSelect={selectConversation}
        onDelete={deleteConversation}
        listError={listError}
      />
      {activeAgentId ? (
        <div className="flex min-w-0 flex-1 flex-col">
          {loadError && (
            <div className="border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-body-sm text-warm-off-white">
              {loadError}
            </div>
          )}
          <Chat
            key={`${activeAgentId}:${chatKey}`}
            agentId={activeAgentId}
            initialConversationId={activeId}
            initialEntries={initialEntries}
            initialTurn={initialTurn}
            status={activeConversation?.status}
            artifactId={activeConversation?.artifactId}
            onConversationCreated={(id) => {
              setActiveId(id);
              writeUrl(id, "replace");
              refreshConversations();
            }}
            onActivity={refreshConversations}
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6">
          {agentsLoaded && (
            <>
              <div className="text-caption-tracked uppercase text-bone-gray">
                No Holmes agent configured
              </div>
              <h1 className="text-heading text-warm-off-white">
                Connect your first agent.
              </h1>
              <p className="max-w-[46ch] text-center text-body text-pale-stone">
                Drill needs a HolmesGPT endpoint to investigate. Add its URL
                and API key — credentials are verified before saving.
              </p>
              <Button onClick={() => setAgentsOpen(true)}>Add agent</Button>
            </>
          )}
        </div>
      )}
      <AgentsDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        agents={agents}
        onChanged={refreshAgents}
      />
    </main>
  );
}
