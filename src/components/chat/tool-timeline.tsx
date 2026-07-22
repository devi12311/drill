"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { TodoItem, ToolCall } from "@/lib/holmes/types";

/** A tool call as it streams in: running until its result arrives. */
export interface LiveToolCall {
  id: string;
  tool_name: string;
  toolCall?: ToolCall;
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
    <div className="rounded-lg bg-smoke-charcoal/60 px-4 py-3">
      <div className="text-caption-tracked uppercase text-bone-gray">
        Investigation plan · {done}/{todos.length}
      </div>
      <ul className="mt-2 space-y-1.5">
        {[...todos]
          .sort((a, b) => Number(a.id) - Number(b.id))
          .map((todo) => (
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

function ToolCallRow({ call }: { call: ToolCall }) {
  // Live statuses observed: success, error, no_data (empty but not failed).
  const failed = call.result.status === "error" || call.result.error !== null;
  const noData = !failed && call.result.status !== "success";
  const output = call.result.data ?? call.result.error ?? "(no output)";
  const params = call.result.params;

  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left hover:bg-iron-veil/40">
        <ChevronRight className="size-3.5 shrink-0 text-bone-gray transition-transform group-data-[state=open]:rotate-90" />
        <span
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            failed
              ? "bg-traffic-red"
              : noData
                ? "bg-traffic-yellow"
                : "bg-traffic-green",
          )}
        />
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

/** Completed-investigation timeline (collapsed by default). */
export function ToolTimeline({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  const todos = latestTodos(toolCalls);
  const steps = toolCalls.filter((c) => c.tool_name !== "TodoWrite");

  if (toolCalls.length === 0) return null;

  return (
    <div className="space-y-3">
      {todos && <TodoWidget todos={todos} />}
      {steps.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="group flex items-center gap-2 text-caption-tracked uppercase text-bone-gray hover:text-pale-stone">
            <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
            Investigation · {steps.length} tool calls
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-0.5 border-l border-border/60 pl-3">
              {steps.map((call, i) => (
                <ToolCallRow key={`${call.tool_call_id}-${i}`} call={call} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

/** In-flight timeline: rows appear as Holmes calls tools. */
export function LiveTimeline({
  calls,
  aiNote,
}: {
  calls: LiveToolCall[];
  aiNote?: string;
}) {
  const todos = latestTodos(calls.map((c) => c.toolCall));
  const steps = calls.filter((c) => c.tool_name !== "TodoWrite");

  return (
    <div className="space-y-3">
      {todos && <TodoWidget todos={todos} />}
      {aiNote && (
        <div className="text-body-sm italic text-bone-gray">{aiNote}</div>
      )}
      {steps.length > 0 && (
        <div className="space-y-0.5 border-l border-border/60 pl-3">
          {steps.map((live, i) =>
            live.toolCall ? (
              <ToolCallRow key={`${live.id}-${i}`} call={live.toolCall} />
            ) : (
              <div
                key={`${live.id}-${i}`}
                className="flex items-center gap-2.5 px-2 py-1.5"
              >
                <span className="size-3.5 shrink-0" />
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-gold-leaf" />
                <span className="font-mono text-[13px] text-pale-stone">
                  {live.tool_name}
                </span>
                <span className="text-body-sm text-bone-gray">running…</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
