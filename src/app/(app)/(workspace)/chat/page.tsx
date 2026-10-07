"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Chat } from "@/components/chat/chat";
import { loadConversation } from "@/components/chat/conversation-api";
import type { ChatEntry } from "@/lib/chat/types";
import { useSession } from "@/components/session/session-provider";
import { useWorkspace } from "@/components/workspace/workspace-provider";
import { writeChatUrl } from "@/lib/workspace/nav";
import type { TurnSnapshot } from "@/lib/chat/types";

/** What the pane shows, and which URL it last followed. */
interface Pane {
  /** The `?c=` this state answers to. */
  url: string | null;
  /** The conversation on screen; null is a new chat. */
  id: string | null;
  entries: ChatEntry[];
  turn: TurnSnapshot | null;
  /** Bumped to remount <Chat> when the context deliberately changes. */
  key: number;
  /** A conversation being fetched to replace what is on screen. */
  loading: string | null;
  error: string | null;
}

function freshPane(url: string | null, key: number): Pane {
  return { url, id: null, entries: [], turn: null, key, loading: url, error: null };
}

/**
 * The chat pane. The open conversation lives in the URL (`/chat?c=<id>`) and
 * ONLY there: the sidebar, the back button, a reload and a shared link all just
 * change `?c=`, and the pane follows. Within the page the URL is written with
 * the History API, which Next syncs with `useSearchParams` — no server round
 * trip. Everything the sidebar needs lives in the workspace layout instead, so
 * it survives a visit to Skills or Resolutions.
 */
function ChatPane() {
  const {
    activeAgentId,
    agentsLoaded,
    adoptAgent,
    openAgents,
    conversations,
    refreshConversations,
  } = useWorkspace();
  const { user } = useSession();
  const c = useSearchParams().get("c");
  const [pane, setPane] = useState<Pane>(() => freshPane(c, 0));

  // Follow the URL. Adjusted during render (React's pattern for reacting to a
  // changed input), so a changed `?c=` never paints the old state first.
  if (c !== pane.url) {
    if (c === pane.id) setPane({ ...pane, url: c, loading: null });
    else if (c === null) setPane(freshPane(null, pane.key + 1));
    // Keep the current conversation on screen until the next one arrives.
    else setPane({ ...pane, url: c, loading: c, error: null });
  }

  const loading = pane.loading;
  const shownId = pane.id;
  useEffect(() => {
    if (!loading) return;
    let stale = false;
    loadConversation(loading)
      .then((loaded) => {
        if (stale) return;
        // A link may point at another of the user's agents; the workspace follows.
        adoptAgent(loaded.agentId);
        setPane((p) =>
          p.loading !== loading
            ? p
            : {
                url: loading,
                id: loading,
                entries: loaded.entries,
                turn: loaded.turn,
                key: p.key + 1,
                loading: null,
                error: null,
              },
        );
      })
      .catch((err) => {
        if (stale) return;
        // Shown in the pane; the URL goes back to what is actually on screen.
        setPane((p) =>
          p.loading !== loading
            ? p
            : {
                ...p,
                url: shownId,
                loading: null,
                error: `Could not open that investigation: ${err instanceof Error ? err.message : "unknown error"}`,
              },
        );
        writeChatUrl(shownId, "replace");
      });
    return () => {
      stale = true;
    };
  }, [loading, shownId, adoptAgent]);


  if (!activeAgentId) {
    return (
      <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-6">
        {agentsLoaded && (
          <>
            <div className="text-caption-tracked uppercase text-bone-gray">
              No Holmes agent configured
            </div>
            {user.isOrgAdmin ? (
              <>
                <h1 className="text-heading text-warm-off-white">
                  Connect your first agent.
                </h1>
                <p className="max-w-[46ch] text-center text-body text-pale-stone">
                  Drill needs a HolmesGPT endpoint to investigate. Add its URL
                  and API key — credentials are verified before saving.
                </p>
                <Button onClick={openAgents}>Add agent</Button>
              </>
            ) : (
              <>
                <h1 className="text-heading text-warm-off-white">
                  Nothing to investigate with yet.
                </h1>
                <p className="max-w-[46ch] text-center text-body text-pale-stone">
                  Drill needs a HolmesGPT agent, and only an owner or admin of{" "}
                  {user.org.name} can connect one. Ask them to add it, then
                  reload this page.
                </p>
              </>
            )}
          </>
        )}
      </div>
    );
  }

  // Opening a link or reload: nothing to keep on screen yet, so show nothing
  // rather than flash the new-chat suggestions.
  if (pane.loading && pane.id === null && !pane.error) {
    return <div className="min-w-0 flex-1" />;
  }

  const shown = conversations.find((conv) => conv.id === pane.id) ?? null;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {pane.error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-6 py-2 text-body-sm text-warm-off-white">
          {pane.error}
        </div>
      )}
      <Chat
        key={`${activeAgentId}:${pane.key}`}
        agentId={activeAgentId}
        initialConversationId={pane.id}
        initialEntries={pane.entries}
        initialTurn={pane.turn}
        status={shown?.status}
        artifactId={shown?.artifactId}
        onConversationCreated={(id) => {
          // The chat on screen now has an id: adopt it without a reload. Only
          // the id — `url` must keep tracking what `useSearchParams` has seen,
          // which lags the replaceState below by a render. Setting it here made
          // that lagging `c === null` read as "new chat", remounting the pane
          // empty and then reloading the conversation (a visible page swap).
          // The URL-follow branch `c === pane.id` adopts the new `?c=` instead.
          setPane((p) => ({ ...p, id }));
          writeChatUrl(id, "replace");
          void refreshConversations();
        }}
        onActivity={refreshConversations}
      />
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="min-w-0 flex-1" />}>
      <ChatPane />
    </Suspense>
  );
}
