"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { interruptionLabel } from "@/lib/chat/describe";
import {
  isActiveTurn,
  type TurnEvent,
  type TurnSnapshot,
  type TurnStreamMessage,
} from "@/lib/chat/types";
import type { LiveItem } from "./tool-timeline";

/** Everything the turn card renders, rebuilt from the stored events. */
export interface TurnView {
  turn: TurnSnapshot;
  items: LiveItem[];
  aiNote?: string;
  /** A follow-up's "about to…" line, shown until the first event arrives. */
  notice?: string;
  /** Server time of the latest event — what "quiet for 1:05" is measured from. */
  lastEventAt: number | null;
  /** serverNow − Date.now(), so timers run on the server's clock. */
  clockOffset: number;
  /** Local time the current status was first seen ("waiting 0:31 for a worker"). */
  statusSince: number;
}

function freshView(turn: TurnSnapshot, notice?: string): TurnView {
  return {
    turn,
    items: [],
    notice,
    lastEventAt: null,
    clockOffset: 0,
    statusSince: Date.now(),
  };
}

function apply(view: TurnView, event: TurnEvent, at: number): TurnView {
  const next = { ...view, lastEventAt: at, notice: undefined };
  switch (event.type) {
    case "tool_start":
      return {
        ...next,
        items: [
          ...view.items,
          { kind: "call", call: { id: event.id, tool_name: event.tool_name } },
        ],
      };
    case "tool_result": {
      const { toolCall } = event;
      const items = [...view.items];
      const idx = items.findIndex(
        (i) =>
          i.kind === "call" &&
          i.call.id === toolCall.tool_call_id &&
          !i.call.toolCall,
      );
      if (idx >= 0) {
        const item = items[idx] as Extract<LiveItem, { kind: "call" }>;
        items[idx] = { kind: "call", call: { ...item.call, toolCall } };
      } else {
        items.push({
          kind: "call",
          call: { id: toolCall.tool_call_id, tool_name: toolCall.tool_name, toolCall },
        });
      }
      return { ...next, items };
    }
    case "ai_message":
      return { ...next, aiNote: event.content };
    case "attempt_started":
      return {
        ...next,
        aiNote: undefined,
        items: [
          ...view.items,
          {
            kind: "resume",
            attempt: event.attempt,
            reason: interruptionLabel(event.reason),
            callsBefore: view.items.filter(
              (i) => i.kind === "call" && i.call.tool_name !== "TodoWrite",
            ).length,
          },
        ],
      };
  }
}

/**
 * Follow one chat turn over `GET /api/chat/turns/[id]/events`.
 *
 * The browser's own EventSource reconnect resumes from the last `id:` (Last-Event-ID),
 * so a network blip loses nothing; the stream is closed by us once the turn stops
 * or settles, which is what keeps the browser from reconnecting forever.
 * `onSettled` fires when the turn row is gone — its answer is in the messages.
 */
export function useTurnStream(
  initial: TurnSnapshot | null,
  /** Gets `follow`, for when a newer turn is already waiting (another tab). */
  onSettled: (follow: (turn: TurnSnapshot) => void) => void,
) {
  const [view, setView] = useState<TurnView | null>(() =>
    initial ? freshView(initial) : null,
  );
  const sourceRef = useRef<EventSource | null>(null);
  const turnIdRef = useRef<string | null>(initial?.id ?? null);
  const lastSeqRef = useRef(0);
  // The retry in `open` reaches the latest `open` through this ref.
  const openRef = useRef<(turnId: string, after: number) => void>(() => {});
  const followRef = useRef<(turn: TurnSnapshot) => void>(() => {});
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });

  const close = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const open = useCallback(
    (turnId: string, after: number) => {
      close();
      const source = new EventSource(
        `/api/chat/turns/${turnId}/events${after ? `?after=${after}` : ""}`,
      );
      sourceRef.current = source;
      source.onmessage = (e) => {
        let message: TurnStreamMessage;
        try {
          message = JSON.parse(e.data);
        } catch {
          return;
        }
        if (message.type === "settled") {
          close();
          turnIdRef.current = null;
          setView(null);
          onSettledRef.current(followRef.current);
        } else if (message.type === "turn") {
          const { turn, serverNow } = message;
          setView(
            (v) =>
              v && {
                ...v,
                turn,
                clockOffset: serverNow - Date.now(),
                statusSince:
                  v.turn.status === turn.status ? v.statusSince : Date.now(),
              },
          );
          if (!isActiveTurn(turn.status)) close();
        } else {
          lastSeqRef.current = message.seq;
          setView((v) => v && apply(v, message.event, message.at));
        }
      };
      source.onerror = () => {
        // While CONNECTING the browser retries by itself. CLOSED means it gave
        // up (a non-200, e.g. a deploy mid-request): retry from where we were.
        if (source.readyState !== EventSource.CLOSED) return;
        setTimeout(() => {
          if (sourceRef.current === source)
            openRef.current(turnId, lastSeqRef.current);
        }, 3_000);
      };
    },
    [close],
  );

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Attach to the turn the conversation already had (a reload, a reopened chat):
  // replayed from the first event, so the timeline is exactly what was live.
  const initialId = initial?.id;
  useEffect(() => {
    if (initialId) open(initialId, 0);
    return close;
  }, [initialId, open, close]);

  /** Start following a newly queued turn. */
  const follow = useCallback(
    (turn: TurnSnapshot, notice?: string) => {
      turnIdRef.current = turn.id;
      lastSeqRef.current = 0;
      setView(freshView(turn, notice));
      open(turn.id, 0);
    },
    [open],
  );

  useEffect(() => {
    followRef.current = follow;
  }, [follow]);

  /** Keep the timeline and continue it after a Resume. */
  const resume = useCallback(() => {
    setView(
      (v) =>
        v && {
          ...v,
          turn: { ...v.turn, status: "queued", error: null },
          statusSince: Date.now(),
        },
    );
    if (turnIdRef.current) open(turnIdRef.current, lastSeqRef.current);
  }, [open]);

  const clear = useCallback(() => {
    close();
    turnIdRef.current = null;
    setView(null);
  }, [close]);

  return { view, follow, resume, clear };
}
