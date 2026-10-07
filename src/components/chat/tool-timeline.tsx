"use client";

import { useState, type ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useSkillBuilder } from "@/components/skills/use-skill-builder";
import { cn } from "@/lib/utils";
import type { TodoItem, ToolCall } from "@/lib/holmes/types";
import { isAddableStep, MAX_SKILL_STEPS, stepKey } from "@/lib/skills/conversation-steps";

/** A tool call as it streams in: running until its result arrives. */
export interface LiveToolCall {
  id: string;
  tool_name: string;
  toolCall?: ToolCall;
  /** A stored call's identity, which lets the skill builder pick it. */
  stepKey?: string;
}

function todosFromParams(call: ToolCall | undefined): TodoItem[] | null {
  const todos = (call?.result.params as { todos?: TodoItem[] } | null)?.todos;
  return todos?.length ? todos : null;
}

/** Latest TodoWrite call wins — it carries the full current task list. */
function latestTodos(toolCalls: (ToolCall | undefined)[]): TodoItem[] | null {
  for (let i = toolCalls.length - 1; i >= 0; i--) {
    const call = toolCalls[i];
    if (call?.tool_name === "TodoWrite") {
      const todos = todosFromParams(call);
      if (todos) return todos;
    }
  }
  return null;
}

function TodoWidget({ todos }: { todos: TodoItem[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className="px-2">
      <div className="text-caption-tracked uppercase text-bone-gray">
        Investigation plan · {done}/{todos.length}
      </div>
      <ul className="mt-2 space-y-1.5">
        {sortedTodos(todos).map((todo) => (
          <li
            key={todo.id}
            className="flex items-baseline gap-2.5 font-mono text-[13px] leading-snug"
          >
            <span
              className={cn(
                "shrink-0",
                todo.status === "completed" && "text-prompt-green",
                todo.status === "in_progress" && "text-gold-leaf",
                todo.status === "pending" && "text-bone-gray",
              )}
            >
              {todo.status === "completed"
                ? "[x]"
                : todo.status === "in_progress"
                  ? "[~]"
                  : "[ ]"}
            </span>
            <span
              className={cn(
                todo.status === "completed"
                  ? "text-bone-gray"
                  : "text-pale-stone",
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function isFailed(call: ToolCall): boolean {
  return call.result.status === "error" || call.result.error !== null;
}

/** Live statuses observed: success, error, no_data (empty but not failed). */
export function callOutcome(call: ToolCall): "ok" | "failed" | "empty" {
  if (isFailed(call)) return "failed";
  return call.result.status === "success" ? "ok" : "empty";
}

export function OutcomeDot({ call }: { call: ToolCall }) {
  const outcome = callOutcome(call);
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        outcome === "failed"
          ? "bg-traffic-red"
          : outcome === "empty"
            ? "bg-traffic-yellow"
            : "bg-traffic-green",
      )}
    />
  );
}

/**
 * A call row; while the skill builder is picking, a stored call also gets the
 * control that adds it as a step — a separate target from the row, which still
 * opens the call's params and output for inspection.
 */
function ToolCallRow({ call, pickKey }: { call: ToolCall; pickKey?: string }) {
  const builder = useSkillBuilder();
  const row = <CallDetails call={call} />;
  if (!builder || !pickKey) return row;

  if (!isAddableStep(call)) {
    return (
      <div
        className="flex items-start gap-1 opacity-50"
        title="Drill runs this on its own — not a step"
      >
        <span className="size-5 shrink-0" />
        <div className="min-w-0 flex-1">{row}</div>
      </div>
    );
  }

  const number = builder.stepNumber(pickKey);
  const full = number === null && builder.picked.length >= MAX_SKILL_STEPS;
  return (
    <div
      data-step-row={pickKey}
      className={cn(
        "flex items-start gap-1 rounded-sm transition-colors",
        number !== null && "ring-1 ring-faint-linen/40",
        builder.flashKey === pickKey && "bg-iron-veil/60 ring-faint-linen",
      )}
    >
      <button
        type="button"
        data-pick-key={pickKey}
        tabIndex={builder.tabKey === pickKey ? 0 : -1}
        aria-pressed={number !== null}
        aria-disabled={full || undefined}
        aria-label={number !== null ? `Remove step ${number}` : `Add ${call.tool_name} as a step`}
        title={full ? `${MAX_SKILL_STEPS} steps max` : undefined}
        onFocus={() => builder.setFocusKey(pickKey)}
        onClick={() => builder.toggle(pickKey)}
        className={cn(
          "mt-1 ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-sm border font-mono text-[11px] tabular-nums outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          number !== null
            ? "border-faint-linen bg-faint-linen text-deep-ember"
            : "border-input text-bone-gray hover:text-warm-off-white",
          full && "opacity-50",
        )}
      >
        {number ?? <Plus className="size-3" />}
      </button>
      <div className="min-w-0 flex-1">{row}</div>
    </div>
  );
}

function CallDetails({ call }: { call: ToolCall }) {
  const output = call.result.data ?? call.result.error ?? "(no output)";
  const params = call.result.params;

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-iron-veil/40">
        <ChevronRight className="size-3.5 shrink-0 text-bone-gray transition-transform group-data-[state=open]:rotate-90" />
        <OutcomeDot call={call} />
        <span className="shrink-0 font-mono text-[13px] text-warm-off-white">
          {call.tool_name}
        </span>
        <span className="truncate text-body-sm text-bone-gray">
          {call.description}
        </span>
        {typeof call.size === "number" && call.size > 0 && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-bone-gray">
            {call.size.toLocaleString()} B
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="my-2 ml-8 overflow-hidden rounded-lg bg-smoke-charcoal">
          <div className="flex items-center gap-2 bg-iron-veil px-3 py-2">
            <span className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-traffic-red" />
              <span className="size-2.5 rounded-full bg-traffic-yellow" />
              <span className="size-2.5 rounded-full bg-traffic-green" />
            </span>
            <span className="font-mono text-[12px] text-pale-stone">
              {call.toolset_name ? `${call.toolset_name} · ` : ""}
              {call.tool_name}
            </span>
          </div>
          {params && Object.keys(params).length > 0 && (
            <pre className="max-h-40 overflow-auto border-b border-border/50 px-4 py-3 font-mono text-[12px] leading-relaxed text-muted-cobalt">
              {JSON.stringify(params, null, 2)}
            </pre>
          )}
          <pre className="max-h-80 overflow-auto px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-warm-off-white/90">
            {output}
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function sortedTodos(todos: TodoItem[]): TodoItem[] {
  return [...todos].sort((a, b) => Number(a.id) - Number(b.id));
}

/** The step Holmes is on: the one in progress, else the next pending one. */
function activeStep(todos: TodoItem[] | null): TodoItem | null {
  if (!todos) return null;
  const sorted = sortedTodos(todos);
  return (
    sorted.find((t) => t.status === "in_progress") ??
    sorted.find((t) => t.status === "pending") ??
    null
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function StatusDot({ state }: { state: "running" | "stopped" | "ok" | "failed" }) {
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        state === "running" && "animate-pulse bg-gold-leaf",
        state === "stopped" && "bg-bone-gray",
        state === "ok" && "bg-traffic-green",
        state === "failed" && "bg-traffic-red",
      )}
    />
  );
}

/**
 * The whole investigation as one line that opens into the plan and every call.
 * Collapsed even while live: a 70-call stack pushes the question off-screen, and
 * the newest call is what the user actually watches.
 */
function TimelinePanel({
  summary,
  todos,
  rows,
  stopped,
  footer,
  forceOpen = false,
}: {
  summary: ReactNode;
  todos: TodoItem[] | null;
  rows: LiveItem[];
  stopped?: boolean;
  footer?: ReactNode;
  /** Held open (picking steps needs every call in view). */
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg bg-smoke-charcoal/60 py-1">
      <Collapsible open={forceOpen || open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-iron-veil/40">
          <ChevronRight className="size-3.5 shrink-0 text-bone-gray transition-transform group-data-[state=open]:rotate-90" />
          {summary}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-2 space-y-3 pl-2">
            {todos && <TodoWidget todos={todos} />}
            {rows.length > 0 && <TimelineRows rows={rows} stopped={stopped} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {footer}
    </div>
  );
}

function planFraction(todos: TodoItem[] | null): string {
  if (!todos) return "";
  return `${todos.filter((t) => t.status === "completed").length}/${todos.length}`;
}

/**
 * Completed-investigation timeline: one collapsed summary line. While the skill
 * builder is picking it opens, and the plan widget steps aside for the calls.
 */
export function ToolTimeline({
  toolCalls,
  messageId,
}: {
  toolCalls: ToolCall[];
  /** The stored message the calls belong to — what makes them pickable. */
  messageId: string;
}) {
  const picking = useSkillBuilder() !== null;
  if (toolCalls.length === 0) return null;
  const todos = latestTodos(toolCalls);
  const steps = toolCalls.filter((c) => c.tool_name !== "TodoWrite");
  const failed = steps.filter(isFailed).length;
  // Indexed against the full list: that index is the step's stored identity.
  const rows: LiveItem[] = toolCalls.flatMap((c, i) =>
    c.tool_name === "TodoWrite"
      ? []
      : [
          {
            kind: "call" as const,
            call: {
              id: `${c.tool_call_id}-${i}`,
              tool_name: c.tool_name,
              toolCall: c,
              stepKey: stepKey(messageId, i),
            },
          },
        ],
  );

  return (
    <TimelinePanel
      todos={picking ? null : todos}
      rows={rows}
      forceOpen={picking}
      summary={
        <>
          <StatusDot state={failed ? "failed" : "ok"} />
          <span className="text-body-sm text-pale-stone">
            Investigated with {plural(steps.length, "tool call")}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-bone-gray">
            {todos ? `plan ${planFraction(todos)}` : ""}
            {failed ? ` · ${failed} failed` : ""}
          </span>
        </>
      }
    />
  );
}

/** Where an attempt began again inside one turn — drawn as a divider. */
export interface ResumeMark {
  kind: "resume";
  attempt: number;
  /** Plain-language reason the previous attempt stopped. */
  reason: string;
  callsBefore: number;
}

export type LiveItem = { kind: "call"; call: LiveToolCall } | ResumeMark;

/**
 * A turn's timeline as it streams in — and, when it stops, as it stopped: the
 * summary line tracks the newest call and the active plan step; opening it shows
 * every row, with a divider wherever a resume picked up.
 */
export function LiveTimeline({
  items,
  aiNote,
  stopped = false,
}: {
  items: LiveItem[];
  aiNote?: string;
  /** The turn has stopped: a call without a result was cut off, not running. */
  stopped?: boolean;
}) {
  const calls = items.flatMap((i) => (i.kind === "call" ? [i.call] : []));
  const todos = latestTodos(calls.map((c) => c.toolCall));
  const rows = items.filter(
    (i) => i.kind === "resume" || i.call.tool_name !== "TodoWrite",
  );
  const steps = calls.filter((c) => c.tool_name !== "TodoWrite");
  const current = steps.at(-1);
  const running = !!current && !current.toolCall && !stopped;
  const step = activeStep(todos);

  return (
    <TimelinePanel
      todos={todos}
      rows={rows}
      stopped={stopped}
      summary={
        <>
          <StatusDot state={running ? "running" : stopped ? "stopped" : "ok"} />
          <span className="shrink-0 font-mono text-[13px] text-warm-off-white">
            {current?.tool_name ?? "Planning"}
          </span>
          <span className="min-w-0 truncate text-body-sm text-bone-gray">
            {current?.toolCall?.description ?? (running ? "running…" : "")}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-bone-gray">
            {todos ? `${planFraction(todos)} · ` : ""}
            {steps.length}
          </span>
        </>
      }
      footer={
        <>
          {step && (
            <p className="truncate px-9 pb-1.5 text-[12px] text-bone-gray">
              Plan · {step.content}
            </p>
          )}
          {aiNote && (
            <p className="px-9 pb-1.5 text-body-sm italic text-bone-gray">{aiNote}</p>
          )}
        </>
      }
    />
  );
}

/** Streamed rows: finished calls, still-running calls, and resume dividers. */
function TimelineRows({
  rows,
  stopped = false,
}: {
  rows: LiveItem[];
  stopped?: boolean;
}) {
  return (
    <div className="space-y-0.5 border-l border-border/60 pl-3">
      {rows.map((item, i) =>
        item.kind === "resume" ? (
          <div
            key={`resume-${item.attempt}`}
            className="flex items-center gap-3 py-2 text-caption-tracked uppercase text-bone-gray"
          >
            <span className="h-px flex-1 bg-border" />
            <span className="shrink-0">
              {item.reason} after {item.callsBefore} tool call
              {item.callsBefore === 1 ? "" : "s"} · resuming from saved
              results · attempt {item.attempt}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        ) : item.call.toolCall ? (
          <ToolCallRow
            key={`${item.call.id}-${i}`}
            call={item.call.toolCall}
            pickKey={item.call.stepKey}
          />
        ) : (
          <div
            key={`${item.call.id}-${i}`}
            className="flex items-center gap-2.5 px-2 py-1.5"
          >
            <span className="size-3.5 shrink-0" />
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                stopped ? "bg-bone-gray" : "animate-pulse bg-gold-leaf",
              )}
            />
            <span className="font-mono text-[13px] text-pale-stone">
              {item.call.tool_name}
            </span>
            <span className="text-body-sm text-bone-gray">
              {stopped ? "interrupted" : "running…"}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
