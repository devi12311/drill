"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, RotateCw, Square } from "lucide-react";
import type { OrbState } from "thinking-orbs";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { turnErrorHeadline } from "@/lib/chat/describe";
import { cn } from "@/lib/utils";
import { DrillOrb } from "./orb";
import { LiveTimeline, type LiveItem } from "./tool-timeline";
import type { TurnView } from "./use-turn-stream";

/** After this long without an event, say what Holmes is doing instead of nothing. */
const QUIET_MS = 10_000;
/** A queued turn this old means nobody is claiming it. */
const NO_WORKER_MS = 30_000;

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useNow(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [enabled]);
  return now;
}

function evidenceCount(items: LiveItem[]): number {
  return items.filter(
    (i) => i.kind === "call" && i.call.toolCall && i.call.tool_name !== "TodoWrite",
  ).length;
}

/**
 * Why an investigation stopped, in the user's words, with the raw error one click
 * away. Shared by the live card (with Resume / Dismiss) and a dismissed turn kept
 * in the transcript (without).
 */
export function StoppedNotice({
  error,
  cancelled,
  savedResults,
  actions,
  footer,
}: {
  error: string | null;
  cancelled: boolean;
  savedResults: number;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const details = error && !error.startsWith("Stopped") ? error : null;
  return (
    <div
      className={cn(
        "space-y-3 rounded-lg border px-4 py-3",
        cancelled
          ? "border-border bg-smoke-charcoal/60"
          : "border-destructive/40 bg-destructive/10",
      )}
    >
      <div className="text-body-sm text-warm-off-white">
        <span
          className={cn(
            "text-caption-tracked mr-3 uppercase",
            cancelled ? "text-bone-gray" : "text-destructive",
          )}
        >
          {cancelled ? "Stopped" : "Interrupted"}
        </span>
        {cancelled
          ? `Stopped after ${savedResults} tool call${savedResults === 1 ? "" : "s"}.`
          : turnErrorHeadline(error)}
      </div>
      {actions && (
        <>
          <p className="text-body-sm text-pale-stone">
            {savedResults > 0
              ? `${savedResults} tool result${savedResults === 1 ? " is" : "s are"} saved — Resume continues from them instead of starting over.`
              : "Nothing had completed yet — Resume runs the question again."}
          </p>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </>
      )}
      {details && (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-caption-tracked uppercase text-bone-gray hover:text-pale-stone">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            Details
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-smoked-onyx px-3 py-2 font-mono text-[12px] whitespace-pre-wrap break-words text-pale-stone">
              {details}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
      {footer}
    </div>
  );
}

/**
 * One investigation, from Send to its answer. It never disappears on failure: the
 * timeline stays, and the next step is one button.
 */
export function TurnCard({
  view,
  onStop,
  onResume,
  onDismiss,
}: {
  view: TurnView;
  /** Absent while the turn is still being queued — there is nothing to stop yet. */
  onStop?: () => void;
  onResume: () => void;
  onDismiss: () => void;
}) {
  const { turn, items } = view;
  const live = turn.status === "queued" || turn.status === "running";
  const localNow = useNow(live);
  // Compared with statusSince rather than reset in an effect: any status change
  // (stopped, then resumed) is newer than the click, so the button comes back.
  const [stopClickedAt, setStopClickedAt] = useState<number | null>(null);
  const stopping = stopClickedAt != null && stopClickedAt >= view.statusSince;
  const serverNow = localNow + view.clockOffset;
  const started = Date.parse(turn.startedAt ?? turn.createdAt);
  const calls = items.filter(
    (i) => i.kind === "call" && i.call.tool_name !== "TodoWrite",
  ).length;
  const inFlight = items.some((i) => i.kind === "call" && !i.call.toolCall);
  const quiet = view.lastEventAt != null ? serverNow - view.lastEventAt : 0;
  const queuedFor = localNow - view.statusSince;

  if (!live) {
    return (
      <div className="space-y-4">
        <LiveTimeline items={items} aiNote={view.aiNote} stopped />
        <StoppedNotice
          error={turn.error}
          cancelled={turn.status === "cancelled"}
          savedResults={evidenceCount(items)}
          actions={
            <>
              {turn.resumable && (
                <Button size="sm" onClick={onResume}>
                  <RotateCw className="size-4" />
                  Resume
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onDismiss}>
                Dismiss
              </Button>
            </>
          }
          footer={
            <p className="text-[12px] text-bone-gray">
              Sending a new message keeps these results in the transcript.
            </p>
          }
        />
      </div>
    );
  }

  let status: string;
  let hint: string | null = null;
  // The orb says the phase at a glance: waiting, gathering, then thinking it over.
  let orb: OrbState = "searching";
  if (turn.status === "queued") {
    orb = "breathing";
    status =
      turn.attempt > 0
        ? "Resuming from saved results…"
        : queuedFor > 2_000
          ? "Waiting for a worker…"
          : "Starting…";
    if (queuedFor > NO_WORKER_MS)
      hint =
        "No worker has picked this up yet — the Drill worker may be down or busy with other investigations.";
  } else if (view.notice && items.length === 0) {
    status = view.notice;
  } else if (!inFlight && quiet > QUIET_MS) {
    orb = "weaving";
    status = `Holmes is reasoning over the results… quiet ${clock(quiet)}`;
    hint = "Long pauses are normal here — the final analysis of a deep investigation can take a few minutes.";
  } else {
    status = `Investigating · ${calls} tool call${calls === 1 ? "" : "s"}`;
  }

  return (
    <div data-turn-card className="space-y-3">
      <div className="flex items-center gap-3 text-body-sm text-bone-gray">
        <DrillOrb state={orb} size={20} />
        <span className="min-w-0 truncate">{status}</span>
        <span className="font-mono text-[12px] tabular-nums">
          {clock(serverNow - started)}
        </span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto"
          disabled={stopping || !onStop}
          onClick={() => {
            setStopClickedAt(Date.now());
            onStop?.();
          }}
        >
          <Square className="size-3" />
          {stopping ? "Stopping…" : "Stop"}
        </Button>
      </div>
      {hint && <p className="text-[12px] text-bone-gray">{hint}</p>}
      <LiveTimeline items={items} aiNote={view.aiNote} />
    </div>
  );
}
