"use client";

import { useEffect, useRef, useState } from "react";
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
import {
  AssistantMessage,
  UserMessage,
  type ChatEntry,
} from "./messages";
import { LiveTimeline, type LiveToolCall } from "./tool-timeline";
import { ResolveDialog } from "@/components/resolutions/resolve-dialog";
import type { FollowUpAction, ToolCall } from "@/lib/holmes/types";
import { DEFAULT_MODEL } from "@/lib/holmes/types";

/** Events emitted by /api/chat (SSE data payloads). */
type StreamEvent =
  | { type: "meta"; conversation_id: string }
  | { type: "tool_start"; id: string; tool_name: string }
  | { type: "tool_result"; toolCall: ToolCall }
  | { type: "ai_message"; content: string }
  | {
      type: "done";
      response: NonNullable<ChatEntry["response"]>;
      drill_duration_ms: number;
    }
  | { type: "error"; message: string };

const EXAMPLE_ASKS = [
  "What is wrong with trace id …? Suggest a fix in the code.",
  "Give me a résumé of the ClickHouse cluster health",
  "Why is deployment X crash-looping in namespace Y?",
];

function ElapsedTimer() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="font-mono text-[12px] tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

interface LiveState {
  calls: LiveToolCall[];
  aiNote?: string;
  notice?: string;
}

export function Chat({
  agentId,
  initialConversationId,
  initialEntries,
  status,
  artifactId,
  onConversationCreated,
  onActivity,
}: {
  agentId: string;
  initialConversationId: string | null;
  initialEntries: ChatEntry[];
  /** Resolution state of the active conversation (from the sidebar list). */
  status?: "open" | "resolved";
  artifactId?: string | null;
  onConversationCreated: (id: string) => void;
  onActivity: () => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<ChatEntry[]>(initialEntries);
  const [live, setLive] = useState<LiveState | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [resolveOpen, setResolveOpen] = useState(false);
  const conversationIdRef = useRef<string | null>(initialConversationId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = live !== null;
  const hasAnswer = entries.some((e) => e.role === "assistant" && e.response);

  async function unresolve() {
    if (!artifactId) return;
    await fetch(`/api/artifacts/${artifactId}`, { method: "DELETE" }).catch(
      () => null,
    );
    onActivity();
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [entries, live]);

  async function send(ask: string, preNotice?: string) {
    setLive({ calls: [], notice: preNotice });
    setEntries((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", ask },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ask,
          model,
          agent_id: agentId,
          conversation_id: conversationIdRef.current ?? undefined,
        }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finished = false;

      const handle = (event: StreamEvent) => {
        switch (event.type) {
          case "meta": {
            if (!conversationIdRef.current) {
              conversationIdRef.current = event.conversation_id;
              setConversationId(event.conversation_id);
              onConversationCreated(event.conversation_id);
            }
            break;
          }
          case "tool_start": {
            setLive((prev) =>
              prev && {
                ...prev,
                notice: undefined,
                calls: [
                  ...prev.calls,
                  {
                    id: event.id || crypto.randomUUID(),
                    tool_name: event.tool_name,
                  },
                ],
              },
            );
            break;
          }
          case "tool_result": {
            setLive((prev) => {
              if (!prev) return prev;
              const calls = [...prev.calls];
              const idx = calls.findIndex(
                (c) => c.id === event.toolCall.tool_call_id && !c.toolCall,
              );
              if (idx >= 0)
                calls[idx] = { ...calls[idx], toolCall: event.toolCall };
              else
                calls.push({
                  id: event.toolCall.tool_call_id || crypto.randomUUID(),
                  tool_name: event.toolCall.tool_name,
                  toolCall: event.toolCall,
                });
              return { ...prev, calls };
            });
            break;
          }
          case "ai_message": {
            setLive((prev) => prev && { ...prev, aiNote: event.content });
            break;
          }
          case "done": {
            setEntries((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                response: {
                  ...event.response,
                  drill_duration_ms: event.drill_duration_ms,
                },
                model,
              },
            ]);
            finished = true;
            onActivity();
            break;
          }
          case "error": {
            setEntries((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                role: "assistant",
                error: event.message,
              },
            ]);
            finished = true;
            break;
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            try {
              handle(JSON.parse(line.slice(5)));
            } catch {
              // skip malformed frame
            }
          }
        }
      }
      if (!finished) throw new Error("Stream ended unexpectedly");
    } catch (err) {
      setEntries((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          error: err instanceof Error ? err.message : "Unknown error",
        },
      ]);
    } finally {
      setLive(null);
    }
  }

  function onFollowUp(action: FollowUpAction) {
    send(action.prompt, action.pre_action_notification_text);
  }

  const empty = entries.length === 0 && !busy;

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
              disabled={!hasAnswer || busy}
              onClick={() => setResolveOpen(true)}
            >
              <CheckCircle2 className="size-4 text-traffic-green" />
              Mark resolved
            </Button>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
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
              {entries.map((entry) =>
                entry.role === "user" ? (
                  <UserMessage key={entry.id} ask={entry.ask!} />
                ) : (
                  <AssistantMessage
                    key={entry.id}
                    entry={entry}
                    onFollowUp={onFollowUp}
                    busy={busy}
                  />
                ),
              )}
              {live && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-body-sm text-bone-gray">
                    <span className="size-2 animate-pulse rounded-full bg-gold-leaf" />
                    <span>{live.notice ?? "Investigating…"}</span>
                    <ElapsedTimer />
                  </div>
                  <LiveTimeline calls={live.calls} aiNote={live.aiNote} />
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[820px] px-6 pb-6 pt-2">
        <Composer
          agentId={agentId}
          onSend={send}
          busy={busy}
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
