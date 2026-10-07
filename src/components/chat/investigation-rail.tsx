"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Plus, ShieldCheck, ShieldX } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSkillBuilder } from "@/components/skills/use-skill-builder";
import {
  callOutcome,
  type ApprovalMark,
  type InvestigationRows,
  type RailRow,
  type ResumeMark,
} from "@/lib/chat/investigations";
import { cn } from "@/lib/utils";
import type { TodoItem, ToolCall } from "@/lib/holmes/types";
import { isAddableStep, MAX_SKILL_STEPS } from "@/lib/skills/conversation-steps";

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

function planFraction(todos: TodoItem[]): string {
  return `${todos.filter((t) => t.status === "completed").length}/${todos.length}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function RailHeading({ children }: { children: ReactNode }) {
  return (
    <div className="px-2 text-caption-tracked uppercase text-bone-gray">{children}</div>
  );
}

function TodoWidget({ todos }: { todos: TodoItem[] }) {
  return (
    <div className="space-y-2">
      <RailHeading>Plan · {planFraction(todos)}</RailHeading>
      <ul className="space-y-1.5 px-2">
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
                "min-w-0 [overflow-wrap:anywhere]",
                todo.status === "completed" ? "text-bone-gray" : "text-pale-stone",
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

export function OutcomeDot({ call }: { call: ToolCall }) {
  const outcome = callOutcome(call);
  return (
    <span
      title={outcome === "awaiting" ? "Waiting for approval" : undefined}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        outcome === "failed" && "bg-traffic-red",
        outcome === "empty" && "bg-traffic-yellow",
        outcome === "awaiting" && "bg-gold-leaf",
        outcome === "ok" && "bg-traffic-green",
      )}
    />
  );
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
 * A call's name and what it did: one line across the column, stacked in the
 * narrow rail where a Prometheus tool name alone fills the width.
 */
function CallLabel({ name, detail }: { name: string; detail: ReactNode }) {
  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2.5 rail:flex-col rail:gap-0.5">
      <span className="max-w-full shrink-0 truncate font-mono text-[13px] text-warm-off-white">
        {name}
      </span>
      <span className="max-w-full min-w-0 truncate text-body-sm text-bone-gray rail:text-[12px]">
        {detail}
      </span>
    </span>
  );
}

const ROW = "flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left rail:items-start";

function CallButton({ call, onOpen }: { call: ToolCall; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className={cn(ROW, "hover:bg-iron-veil/40")}>
      <span className="flex h-5 items-center rail:h-[1.3rem]">
        <OutcomeDot call={call} />
      </span>
      <CallLabel name={call.tool_name} detail={call.description} />
      {typeof call.size === "number" && call.size > 0 && (
        <span className="ml-auto shrink-0 font-mono text-[11px] text-bone-gray rail:hidden">
          {call.size.toLocaleString()} B
        </span>
      )}
    </button>
  );
}

/**
 * A call row; while the skill builder is picking, a stored call also gets the
 * control that adds it as a step — a separate target from the row, which still
 * opens the call's params and output for inspection.
 */
function ToolCallRow({
  call,
  pickKey,
  onOpen,
}: {
  call: ToolCall;
  pickKey?: string;
  onOpen: () => void;
}) {
  const builder = useSkillBuilder();
  const row = <CallButton call={call} onOpen={onOpen} />;
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

function ResumeDivider({ mark }: { mark: ResumeMark }) {
  return (
    <div className="flex items-center gap-3 px-2 py-2 text-caption-tracked uppercase text-bone-gray">
      <span className="h-px flex-1 bg-border" />
      <span className="min-w-0 shrink text-center">
        {mark.reason} after {plural(mark.callsBefore, "tool call")} · resuming from
        saved results · attempt {mark.attempt}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

function ApprovalRow({ mark }: { mark: ApprovalMark }) {
  const Icon = mark.approved ? ShieldCheck : ShieldX;
  return (
    <div className={ROW} title={mark.feedback}>
      <span className="flex h-5 items-center">
        <Icon className="size-3.5 shrink-0 text-bone-gray" />
      </span>
      <CallLabel
        name={`${mark.approved ? "approved" : "denied"} · ${mark.tool_name}`}
        detail={mark.feedback ?? mark.description}
      />
    </div>
  );
}

/** A call whose result has not arrived: running, or cut off when the turn stopped. */
function PendingRow({ name, stopped }: { name: string; stopped: boolean }) {
  return (
    <div className={ROW}>
      <span className="flex h-5 items-center">
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            stopped ? "bg-bone-gray" : "animate-pulse bg-gold-leaf",
          )}
        />
      </span>
      <CallLabel name={name} detail={stopped ? "interrupted" : "running…"} />
    </div>
  );
}

/** The terminal-window view of one call — params, then output. */
function CallDialog({
  calls,
  index,
  onIndex,
}: {
  calls: ToolCall[];
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const call = index === null ? undefined : calls[index];
  // `data` is "" (not null) on many failures; the error is the output then.
  const output = call ? call.result.data || call.result.error || "(no output)" : "";
  const params = call?.result.params;
  return (
    <Dialog open={!!call} onOpenChange={(open) => !open && onIndex(null)}>
      <DialogContent
        size="lg"
        onKeyDown={(e) => {
          // ↑/↓ walk the investigation's calls without closing the dialog.
          if (index === null || e.target instanceof HTMLTextAreaElement) return;
          const next = e.key === "ArrowDown" ? index + 1 : e.key === "ArrowUp" ? index - 1 : null;
          if (next === null || next < 0 || next >= calls.length) return;
          e.preventDefault();
          onIndex(next);
        }}
      >
        {call && (
          <>
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2.5 font-mono text-[14px]">
                <OutcomeDot call={call} />
                {call.tool_name}
                <span className="ml-auto font-sans text-[12px] font-normal tabular-nums text-bone-gray">
                  {index! + 1} / {calls.length} · ↑↓
                </span>
              </DialogTitle>
              <DialogDescription className="break-words">{call.description}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="overflow-hidden rounded-lg bg-smoke-charcoal">
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
                  <pre className="max-h-48 overflow-auto border-b border-border/50 px-4 py-3 font-mono text-[12px] leading-relaxed text-muted-cobalt">
                    {JSON.stringify(params, null, 2)}
                  </pre>
                )}
                <pre className="px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap break-words text-warm-off-white/90">
                  {output}
                </pre>
              </div>
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RailRows({
  rows,
  stopped,
  onOpen,
}: {
  rows: RailRow[];
  stopped: boolean;
  onOpen: (toolCall: ToolCall) => void;
}) {
  return (
    <div className="space-y-0.5">
      {rows.map((row, i) =>
        row.kind === "resume" ? (
          <ResumeDivider key={`resume-${row.attempt}`} mark={row} />
        ) : row.kind === "approval" ? (
          <ApprovalRow key={row.id} mark={row} />
        ) : row.call.toolCall ? (
          <ToolCallRow
            key={`${row.call.id}-${i}`}
            call={row.call.toolCall}
            pickKey={row.call.stepKey}
            onOpen={() => onOpen(row.call.toolCall!)}
          />
        ) : (
          <PendingRow key={`${row.call.id}-${i}`} name={row.call.tool_name} stopped={stopped} />
        ),
      )}
    </div>
  );
}

/**
 * One investigation's plan and calls. Beside the answer when the pane is wide
 * (the `rail` variant): always open, held in view while its investigation
 * scrolls past. Narrower, it is one summary line above the answer that opens
 * into the same content — the newest call is what a reader watches live, and a
 * 70-call stack would push the question off-screen.
 */
export function InvestigationRail({
  data,
  live = false,
  stopped = false,
  className,
}: {
  data: InvestigationRows;
  /** Where the rail sits in the investigation's grid. */
  className?: string;
  /** The investigation's turn is running now. */
  live?: boolean;
  /** Its turn stopped: a call without a result was cut off, not running. */
  stopped?: boolean;
}) {
  const picking = useSkillBuilder() !== null;
  const [open, setOpen] = useState(false);
  const [dialogIndex, setDialogIndex] = useState<number | null>(null);
  const { todos, rows, calls, failed } = data;
  const results = rows.flatMap((r) => (r.kind === "call" && r.call.toolCall ? [r.call.toolCall] : []));
  const latest = rows.findLast((r) => r.kind === "call");
  const running = live && latest?.kind === "call" && !latest.call.toolCall;
  const step = live ? activeStep(todos) : null;
  // As the rail, the call list scrolls on its own: while live it follows the
  // newest call — unless the reader has scrolled up in it to look at one.
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && live && followRef.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, live]);
  // Picking needs every call in view; the plan steps aside for them.
  const expanded = open || picking;
  const shownTodos = picking ? null : todos;

  const counts = (
    <>
      {plural(calls, "call")}
      {failed > 0 && ` · ${failed} failed`}
    </>
  );

  // As the rail it is capped to the visible transcript (100cqh of the scroll
  // area, less the transcript's 2rem padding top and bottom), so its call list
  // scrolls inside it — a growing investigation never lengthens the page.
  return (
    <aside
      aria-label="Investigation plan and tool calls"
      className={cn(
        "rounded-lg bg-smoke-charcoal/60 py-1",
        "rail:sticky rail:top-8 rail:flex rail:max-h-[calc(100cqh-4rem)] rail:flex-col rail:self-start rail:rounded-none rail:border-r rail:border-border/60 rail:bg-transparent rail:py-0 rail:pr-3",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen((o) => !o)}
        className="group flex w-full min-w-0 items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-iron-veil/40 rail:hidden"
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-bone-gray transition-transform",
            expanded && "rotate-90",
          )}
        />
        <StatusDot
          state={running ? "running" : stopped ? "stopped" : failed ? "failed" : "ok"}
        />
        {live || stopped ? (
          <>
            <span className="shrink-0 font-mono text-[13px] text-warm-off-white">
              {latest?.kind === "call" ? latest.call.tool_name : "Planning"}
            </span>
            <span className="min-w-0 truncate text-body-sm text-bone-gray">
              {latest?.kind === "call"
                ? (latest.call.toolCall?.description ?? (running ? "running…" : ""))
                : ""}
            </span>
          </>
        ) : (
          <span className="text-body-sm text-pale-stone">
            Investigated with {plural(calls, "tool call")}
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-bone-gray">
          {todos ? `plan ${planFraction(todos)} · ` : ""}
          {calls}
          {failed > 0 && !live ? ` · ${failed} failed` : ""}
        </span>
      </button>
      {step && !expanded && (
        <p className="truncate px-9 pb-1.5 text-[12px] text-bone-gray rail:hidden">
          Plan · {step.content}
        </p>
      )}

      <div
        className={cn(
          "mt-2 space-y-4 pb-2 pl-2 rail:mt-0 rail:flex rail:min-h-0 rail:flex-col rail:pb-0 rail:pl-0",
          // Open by its toggle when narrow; always open as the rail.
          !expanded && "hidden",
        )}
      >
        {shownTodos ? (
          <TodoWidget todos={shownTodos} />
        ) : (
          live &&
          !picking && <RailHeading>Planning…</RailHeading>
        )}
        {rows.length > 0 && (
          <div className="flex min-h-0 flex-col gap-2">
            <RailHeading>{counts}</RailHeading>
            <div
              ref={listRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
              }}
              className="min-h-0 overflow-y-auto border-l border-border/60 pl-1 rail:border-l-0 rail:pl-0"
            >
              <RailRows
                rows={rows}
                stopped={stopped}
                onOpen={(call) => setDialogIndex(results.indexOf(call))}
              />
            </div>
          </div>
        )}
      </div>
      <CallDialog calls={results} index={dialogIndex} onIndex={setDialogIndex} />
    </aside>
  );
}
