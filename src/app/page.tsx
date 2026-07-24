"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chat } from "@/components/chat/chat";
import {
  Sidebar,
  type ConversationSummary,
} from "@/components/chat/sidebar";
import {
  AgentsDialog,
  type AgentSummary,
} from "@/components/agents/agents-dialog";
import type { ChatEntry } from "@/components/chat/messages";

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  response: ChatEntry["response"] | null;
}

const AGENT_STORAGE_KEY = "drill.activeAgentId";

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [initialEntries, setInitialEntries] = useState<ChatEntry[]>([]);
  // Chat remounts only when we intentionally switch context (new/select/agent).
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => {
        // Stale session (e.g. user row gone after a dev DB wipe): the JWT
        // passes the edge guard but the API rejects it — go log in again.
        if (res.status === 401) {
          router.push("/login");
          return null;
        }
        return res.ok ? res.json() : null;
      })
      .then((me: { username?: string; isAdmin?: boolean } | null) => {
        if (me?.username) setUsername(me.username);
        setIsAdmin(Boolean(me?.isAdmin));
      })
      .catch(() => {});
  }, [router]);

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

  function newChat() {
    setActiveId(null);
    setInitialEntries([]);
    setChatKey((k) => k + 1);
  }

  function selectAgent(id: string) {
    if (id === activeAgentId) return;
    localStorage.setItem(AGENT_STORAGE_KEY, id);
    setActiveAgentId(id);
    newChat();
  }

  async function selectConversation(id: string) {
    if (id === activeId) return;
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const body = (await res.json()) as StoredMessage[] | { error: string };
      if (!res.ok || !Array.isArray(body))
        throw new Error("error" in body ? body.error : `HTTP ${res.status}`);
      const entries: ChatEntry[] = body.map((msg) =>
        msg.role === "user"
          ? { id: msg.id, role: "user", ask: msg.content }
          : {
              id: msg.id,
              role: "assistant",
              response: msg.response ?? undefined,
              model: msg.model ?? undefined,
              error: msg.response ? undefined : "Response not stored",
            },
      );
      setActiveId(id);
      setInitialEntries(entries);
      setChatKey((k) => k + 1);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load chat");
    }
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

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="flex h-dvh w-full">
      <Sidebar
        username={username}
        isAdmin={isAdmin}
        agents={agents}
        activeAgentId={activeAgentId}
        onSelectAgent={selectAgent}
        onManageAgents={() => setAgentsOpen(true)}
        conversations={conversations}
        activeId={activeId}
        onNewChat={newChat}
        onSelect={selectConversation}
        onDelete={deleteConversation}
        onLogout={logout}
        listError={listError}
      />
      {activeAgentId ? (
        <Chat
          key={`${activeAgentId}:${chatKey}`}
          agentId={activeAgentId}
          initialConversationId={activeId}
          initialEntries={initialEntries}
          status={activeConversation?.status}
          artifactId={activeConversation?.artifactId}
          onConversationCreated={(id) => {
            setActiveId(id);
            refreshConversations();
          }}
          onActivity={refreshConversations}
        />
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
