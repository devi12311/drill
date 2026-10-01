"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Composer } from "./composer";
import { loadConversation } from "./conversation-api";
import {
  AssistantMessage,
  UserMessage,
  type ChatEntry,
} from "./messages";
import { TurnCard } from "./turn-card";
import { useTurnStream } from "./use-turn-stream";
import { ResolveDialog } from "@/components/resolutions/resolve-dialog";
import { useSession } from "@/components/session/session-provider";
import { isActiveTurn, type TurnSnapshot } from "@/lib/chat/types";
import { cn } from "@/lib/utils";
import type {
  FollowUpAction,
  ToolApprovalDecision,
} from "@/lib/holmes/types";

const EXAMPLE_ASKS = [
  "What is wrong with trace id …? Suggest a fix in the code.",
  "Give me a résumé of the ClickHouse cluster health",
  "Why is deployment X crash-looping in namespace Y?",
];

/** Within this many px of the bottom, new progress keeps the view pinned there. */
const STICK_PX = 120;

/** The agent's served models, in its order; null while loading, [] on failure. */
function useModels(agentId: string): string[] | null {
  // Tagged with the agent it came from, so switching agents reads as loading
  // instead of briefly offering the previous agent's models.
  const [entry, setEntry] = useState<{ agentId: string; models: string[] } | null>(null);
  useEffect(() => {
    fetch(`/api/agents/${agentId}/models`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { models?: string[] } | null) =>
        setEntry({ agentId, models: body?.models ?? [] }),
      )
      .catch(() => setEntry({ agentId, models: [] }));
  }, [agentId]);
  return entry?.agentId === agentId ? entry.models : null;
}

/** What a just-queued turn looks like until its stream sends the real row. */
function queuedTurn(id: string): TurnSnapshot {
  return {
    id,
    status: "queued",
    attempt: 0,
    error: null,
    resumable: true,
    createdAt: new Date().toISOString(),
    startedAt: null,
  };
}

async function postTurnAction(turnId: string, action: string) {
  const res = await fetch(`/api/chat/turns/${turnId}/${action}`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `HTTP ${res.status}`);
  }
}

export function Chat({
  agentId,
  initialConversationId,
  initialEntries,
  initialTurn,
  status,
  artifactId,
  onConversationCreated,
  onActivity,
}: {
  agentId: string;
  initialConversationId: string | null;
  initialEntries: ChatEntry[];
  /** The conversation's open turn when it was opened — reattached on mount. */
  initialTurn: TurnSnapshot | null;
  /** Resolution state of the active conversation (from the sidebar list). */
  status?: "open" | "resolved";
  artifactId?: string | null;
  onConversationCreated: (id: string) => void;
  /** Something the sidebar shows changed (a turn started, settled, stopped). */
  onActivity: () => void;
}) {
  const router = useRouter();
  const { user } = useSession();
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [actionError, setActionError] = useState<string | null>(null);
  const models = useModels(agentId);
  const [pickedModel, setModel] = useState<string | null>(null);
  // Derived, not stored: the agent's first model IS the default, and a pick
  // the agent no longer serves (or one from another agent) falls back to it.
  const model =
    pickedModel && models?.includes(pickedModel)
      ? pickedModel
      : (models?.[0] ?? null);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [resolveOpen, setResolveOpen] = useState(false);
  const conversationIdRef = useRef<string | null>(initialConversationId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  /** Messages are the one source of truth once a turn settles or is dismissed. */
  const refresh = useCallback(async () => {
    const id = conversationIdRef.current;
    if (!id) return null;
    try {
      const loaded = await loadConversation(id);
      setEntries(loaded.entries);
      return loaded;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reload");
      return null;
    }
  }, []);

  const { view, follow, resume, clear } = useTurnStream(
    initialTurn,
    async (followNext) => {
      const loaded = await refresh();
      // Another tab may have queued the next question already.
      if (loaded?.turn) followNext(loaded.turn);
      onActivity();
    },
  );
  const active = view != null && isActiveTurn(view.turn.status);
  const hasAnswer = entries.some((e) => e.role === "assistant" && e.response);

  async function unresolve() {
    if (!artifactId) return;
    await fetch(`/api/artifacts/${artifactId}`, { method: "DELETE" }).catch(
      () => null,
    );
    onActivity();
  }

  // Follow the progress only while the reader is at the bottom: expanding a
  // tool's output mid-investigation must not be yanked away by the next event.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current)
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [entries, view]);

  function send(ask: string, preNotice?: string) {
    return run(ask, { ask }, preNotice);
  }

  /** Answers the pending approval; the summary mirrors what the server stores. */
  function decide(decisions: ToolApprovalDecision[]) {
    const pending =
      entries[entries.length - 1]?.response?.pending_approvals ?? [];
    const summary = decisions
      .map((d) => {
        const name =
          pending.find((a) => a.tool_call_id === d.tool_call_id)?.tool_name ??
          "tool";
        if (d.approved) return `Approved ${name}`;
        return d.feedback ? `Denied ${name}: ${d.feedback}` : `Denied ${name}`;
      })
      .join("\n");
    return run(summary, { tool_decisions: decisions });
  }

  /**
   * Queue a turn and follow it. Resolves false when nothing was queued, so the
   * composer can put the question back.
   */
  async function run(
    userLine: string,
    payload: { ask: string } | { tool_decisions: ToolApprovalDecision[] },
    preNotice?: string,
  ): Promise<boolean> {
    if (!model) return false;
    setActionError(null);
    stickRef.current = true;
    // Sending over a stopped turn files it into the transcript server-side.
    const replacesStopped = view != null && !active;
    const optimisticId = crypto.randomUUID();
    setEntries((prev) => [
      ...prev,
      { id: optimisticId, role: "user", ask: userLine },
    ]);
    const unsend = () =>
      setEntries((prev) => prev.filter((e) => e.id !== optimisticId));
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          model,
          agent_id: agentId,
          conversation_id: conversationIdRef.current ?? undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.turn_id) {
        // Already investigating here — started from another tab. Show that one.
        unsend();
        const loaded = await refresh();
        if (loaded?.turn) follow(loaded.turn);
        setActionError(
          "An investigation is already running in this conversation — showing it. Send again once it finishes.",
        );
        return false;
      }
      if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
      if (!conversationIdRef.current) {
        conversationIdRef.current = body.conversation_id;
        setConversationId(body.conversation_id);
        onConversationCreated(body.conversation_id);
      }
      if (replacesStopped) {
        clear();
        await refresh();
      }
      follow(queuedTurn(body.turn_id), preNotice);
      onActivity();
      return true;
    } catch (err) {
      unsend();
      setActionError(err instanceof Error ? err.message : "Could not send");
      return false;
    }
  }

  async function turnAction(action: "cancel" | "resume" | "dismiss") {
    if (!view) return;
    setActionError(null);
    try {
      await postTurnAction(view.turn.id, action);
      if (action === "resume") resume();
      if (action === "dismiss") {
        clear();
        await refresh();
      }
      onActivity();
    } catch (err) {
      // A Stop that lands after the answer is not an error worth showing.
      if (action !== "cancel")
        setActionError(err instanceof Error ? err.message : "Request failed");
    }
  }

  function onFollowUp(action: FollowUpAction) {
    send(action.prompt, action.pre_action_notification_text);
  }

  const empty = entries.length === 0 && !view;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {conversationId && (
        <div className="flex items-center justify-end border-b border-border px-6 py-2">
          {status === "resolved" ? (
            <DropdownMenu>
              <DropdownMenuTrigger className="flex items-center gap-2 rounded-sm border border-input px-3 py-1.5 text-body-sm text-pale-stone hover:bg-smoke-charcoal hover:text-warm-off-white">
                <span className="size-1.5 rounded-full bg-traffic-green" />
                Resolved
                <ChevronDown className="size-3.5 text-bone-gray" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() =>
                    artifactId && router.push(`/resolutions/${artifactId}`)
                  }
                >
                  View artifact
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setResolveOpen(true)}>
                  Re-resolve (regenerate)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={unresolve}>
                  Unresolve
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              className="gap-2"
              disabled={!hasAnswer || active}
              onClick={() => setResolveOpen(true)}
            >
              <CheckCircle2 className="size-4 text-traffic-green" />
              Mark resolved
            </Button>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[820px] px-6">
          {empty ? (
            <div className="flex h-full flex-col justify-center pt-[18vh]">
              <div className="text-caption-tracked uppercase text-bone-gray">
                AI SRE · HolmesGPT
              </div>
              <h1 className="mt-3 text-heading-lg text-warm-off-white">
                Ask the cluster.
              </h1>
              <p className="mt-2 max-w-[60ch] text-subheading text-pale-stone">
                Traces, logs, metrics, databases and deployed code — Drill
                investigates across all of it and comes back with a root cause.
              </p>
              <div className="mt-8 space-y-2">
                {EXAMPLE_ASKS.map((ask) => (
                  <div
                    key={ask}
                    className="flex items-baseline gap-3 font-mono text-body-sm text-bone-gray"
                  >
                    <span className="size-1.5 translate-y-[-2px] rounded-full bg-prompt-green" />
                    {ask}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-8 py-8">
              {entries.map((entry, i) =>
                entry.role === "user" ? (
                  <UserMessage key={entry.id} ask={entry.ask!} />
                ) : (
                  <AssistantMessage
                    key={entry.id}
                    entry={entry}
                    onFollowUp={onFollowUp}
                    onDecide={decide}
                    busy={active}
                    isLatest={i === entries.length - 1}
                  />
                ),
              )}
              {view && (
                <TurnCard
                  view={view}
                  onStop={() => turnAction("cancel")}
                  onResume={() => turnAction("resume")}
                  onDismiss={() => turnAction("dismiss")}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {/*
        The mode island is fixed in the bottom-right, where it would sit on the
        composer's send button on narrow viewports. Reserve room for it — but
        only for the admins who actually see it, and only below xl, where the
        centred column no longer leaves that margin on its own.
      */}
      <div
        className={cn(
          "mx-auto w-full max-w-[820px] px-6 pb-6 pt-2",
          user.actorIsAdmin && "pr-20 xl:pr-6",
        )}
      >
        {actionError && (
          <p className="mb-2 text-body-sm text-destructive">{actionError}</p>
        )}
        <Composer
          onSend={send}
          onStop={() => turnAction("cancel")}
          busy={active}
          models={models}
          model={model}
          onModelChange={setModel}
        />
      </div>
      {conversationId && (
        <ResolveDialog
          open={resolveOpen}
          onOpenChange={setResolveOpen}
          conversationId={conversationId}
          onResolved={() => onActivity()}
        />
      )}
    </div>
  );
}
