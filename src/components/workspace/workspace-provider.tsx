"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { AGENT_STORAGE_KEY, pickActiveAgent } from "@/components/agents/active-agent";
import { AgentsDialog, type AgentSummary } from "@/components/agents/agents-dialog";
import { CHAT_HOME } from "@/lib/routes";
import { writeChatUrl } from "@/lib/workspace/nav";
import {
  isInvestigating,
  type ConversationActivity,
  type ConversationSummary,
} from "@/lib/chat/types";

/** While anything is investigating, the list is re-read this often (its dots). */
const LIST_POLL_MS = 10_000;

/** The tab title when something finished while the tab was in the background. */
function finishedTitle(activity: ConversationActivity): string {
  if (activity === "awaiting_approval") return "! Needs approval";
  if (activity === "failed" || activity === "cancelled")
    return "✕ Investigation stopped";
  return "✓ Answer ready";
}

interface ModelsEntry {
  models: string[];
  /** A failed fetch is shown as "no models" but retried by the next chat mount. */
  ok: boolean;
}

interface WorkspaceValue {
  agents: AgentSummary[];
  agentsLoaded: boolean;
  activeAgentId: string | null;
  /** The user picked an agent: Recent follows it, and on /chat a new chat starts. */
  selectAgent: (id: string) => void;
  /** A conversation opened by link belongs to another of the user's agents. */
  adoptAgent: (id: string) => void;
  refreshAgents: () => Promise<void>;
  openAgents: () => void;

  conversations: ConversationSummary[];
  listError: string | null;
  refreshConversations: () => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;


  modelsByAgent: Record<string, ModelsEntry>;
  ensureModels: (agentId: string) => void;
  /** Bumped when the cache is dropped, so mounted chats ask again. */
  modelsGeneration: number;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/**
 * Everything the chat sidebar shows, held by the workspace layout so it
 * survives moving between chat, Resolutions and Skills: the agents,
 * the Recent list and its polling, the tab title, and the agents dialog. Before
 * this lived in the chat page, and leaving /chat threw all of it away (docs/
 * DECISIONS.md, 116). The chat pane itself still remounts — cheaply: its models
 * come from the cache here, and its URL says which conversation to reopen.
 */
export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const onChat = pathname === CHAT_HOME;

  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentsLoaded, setAgentsLoaded] = useState(false);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  // Tagged with the agent it was read for, so switching agents never shows the
  // previous agent's list — and "no agent" needs no reset, it is simply empty.
  const [list, setList] = useState<{ agentId: string; items: ConversationSummary[] } | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const [modelsByAgent, setModelsByAgent] = useState<Record<string, ModelsEntry>>({});
  const [modelsGeneration, setModelsGeneration] = useState(0);
  const modelsRef = useRef<Record<string, ModelsEntry>>({});
  const inflight = useRef(new Set<string>());

  const conversations = useMemo(
    () => (list && list.agentId === activeAgentId ? list.items : []),
    [list, activeAgentId],
  );

  const refreshAgents = useCallback(async () => {
    try {
      const res = await fetch("/api/agents");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const next = body as AgentSummary[];
      setAgents(next);
      setActiveAgentId((current) => pickActiveAgent(next, current));
      // An agent was added, removed or re-pointed: what it serves may differ.
      modelsRef.current = {};
      setModelsByAgent({});
      setModelsGeneration((g) => g + 1);
    } catch {
      // ignore; the sidebar shows its empty state
    } finally {
      setAgentsLoaded(true);
    }
  }, []);

  useEffect(() => {
    // Every setState in it runs after an `await`; the rule cannot see through
    // the call and flags it as synchronous.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshAgents();
  }, [refreshAgents]);

  const refreshConversations = useCallback(async () => {
    if (!activeAgentId) return;
    try {
      const res = await fetch(`/api/conversations?agent_id=${activeAgentId}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setList({ agentId: activeAgentId, items: body });
      setListError(null);
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load history");
    }
  }, [activeAgentId]);

  useEffect(() => {
    // As above: the state is only set after the fetch resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshConversations();
  }, [refreshConversations]);

  // The dots of running conversations change without anyone doing anything.
  const anyInvestigating = conversations.some(isInvestigating);
  useEffect(() => {
    if (!anyInvestigating) return;
    const timer = setInterval(refreshConversations, LIST_POLL_MS);
    return () => clearInterval(timer);
  }, [anyInvestigating, refreshConversations]);

  // Tab title: "● Investigating" while anything runs; when one finishes with the
  // tab in the background, say how, until the user looks again. Lives here, not
  // in the chat page, so it keeps working while the user reads a skill.
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

  const selectAgent = useCallback(
    (id: string) => {
      if (id === activeAgentId) return;
      localStorage.setItem(AGENT_STORAGE_KEY, id);
      setActiveAgentId(id);
      // The open conversation belongs to the old agent; on the chat page the
      // pane follows the URL to a new chat.
      if (onChat) writeChatUrl(null, "push");
    },
    [activeAgentId, onChat],
  );

  const adoptAgent = useCallback((id: string) => {
    setActiveAgentId((current) => {
      if (current === id) return current;
      localStorage.setItem(AGENT_STORAGE_KEY, id);
      return id;
    });
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      await fetch(`/api/conversations/${id}`, { method: "DELETE" }).catch(() => null);
      // Deleting the conversation on screen drops the pane back to a new chat.
      if (onChat && new URLSearchParams(window.location.search).get("c") === id) {
        writeChatUrl(null, "replace");
      }
      await refreshConversations();
    },
    [onChat, refreshConversations],
  );

  const ensureModels = useCallback((agentId: string) => {
    if (modelsRef.current[agentId]?.ok || inflight.current.has(agentId)) return;
    inflight.current.add(agentId);
    const settle = (entry: ModelsEntry) => {
      inflight.current.delete(agentId);
      modelsRef.current = { ...modelsRef.current, [agentId]: entry };
      setModelsByAgent(modelsRef.current);
    };
    fetch(`/api/agents/${agentId}/models`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { models?: string[] } | null) =>
        settle({ models: body?.models ?? [], ok: body !== null }),
      )
      .catch(() => settle({ models: [], ok: false }));
  }, []);

  const value = useMemo<WorkspaceValue>(
    () => ({
      agents,
      agentsLoaded,
      activeAgentId,
      selectAgent,
      adoptAgent,
      refreshAgents,
      openAgents: () => setAgentsOpen(true),
      conversations,
      listError,
      refreshConversations,
      deleteConversation,
      modelsByAgent,
      ensureModels,
      modelsGeneration,
    }),
    [
      agents,
      agentsLoaded,
      activeAgentId,
      selectAgent,
      adoptAgent,
      refreshAgents,
      conversations,
      listError,
      refreshConversations,
      deleteConversation,
      modelsByAgent,
      ensureModels,
      modelsGeneration,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
      <AgentsDialog
        open={agentsOpen}
        onOpenChange={setAgentsOpen}
        agents={agents}
        onChanged={refreshAgents}
      />
    </WorkspaceContext.Provider>
  );
}

/** The workspace state. Only valid inside the `(workspace)` layout. */
export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/**
 * The agent's served models, in its order — the first is the default (CLAUDE.md).
 * Null while loading, [] on failure. Cached per agent for the session, so
 * returning to the chat does not ask Holmes again.
 */
export function useAgentModels(agentId: string): string[] | null {
  const { modelsByAgent, ensureModels, modelsGeneration } = useWorkspace();
  useEffect(() => {
    ensureModels(agentId);
  }, [agentId, ensureModels, modelsGeneration]);
  return modelsByAgent[agentId]?.models ?? null;
}
