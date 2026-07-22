"use client";

import { Markdown } from "./markdown";
import { ToolTimeline } from "./tool-timeline";
import type { FollowUpAction, HolmesChatResponse } from "@/lib/holmes/types";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  /** user entries */
  ask?: string;
  /** assistant entries */
  response?: HolmesChatResponse & { drill_duration_ms?: number };
  error?: string;
  model?: string;
}

/** User ask rendered as a terminal command line (DESIGN.md brew-chip voice). */
export function UserMessage({ ask }: { ask: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="mt-1 size-2 shrink-0 translate-y-[-1px] rounded-full bg-prompt-green" />
      <p className="min-w-0 flex-1 font-mono text-body whitespace-pre-wrap break-words text-warm-off-white">
        {ask}
      </p>
    </div>
  );
}

function CostFooter({
  response,
  model,
}: {
  response: ChatEntry["response"];
  model?: string;
}) {
  const meta = response?.metadata;
  if (!meta) return null;
  const parts: string[] = [];
  if (model) parts.push(model);
  if (meta.costs?.total_cost != null)
    parts.push(`$${meta.costs.total_cost.toFixed(4)}`);
  if (meta.usage?.total_tokens != null)
    parts.push(`${meta.usage.total_tokens.toLocaleString()} tok`);
  if (response?.drill_duration_ms != null)
    parts.push(`${Math.round(response.drill_duration_ms / 1000)}s`);
  if (parts.length === 0) return null;
  return (
    <div className="text-caption-tracked uppercase text-bone-gray">
      {parts.join(" · ")}
    </div>
  );
}

export function FollowUpChips({
  actions,
  onPick,
  disabled,
}: {
  actions: FollowUpAction[];
  onPick: (action: FollowUpAction) => void;
  disabled: boolean;
}) {
  if (actions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          disabled={disabled}
          onClick={() => onPick(action)}
          className="rounded-sm border border-input px-3 py-1.5 text-body-sm text-pale-stone transition-colors hover:bg-iron-veil hover:text-warm-off-white disabled:pointer-events-none disabled:opacity-50"
        >
          {action.action_label}
        </button>
      ))}
    </div>
  );
}

export function AssistantMessage({
  entry,
  onFollowUp,
  busy,
}: {
  entry: ChatEntry;
  onFollowUp: (action: FollowUpAction) => void;
  busy: boolean;
}) {
  if (entry.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-body-sm text-warm-off-white">
        <span className="text-caption-tracked mr-3 uppercase text-destructive">
          Error
        </span>
        {entry.error}
      </div>
    );
  }
  const response = entry.response;
  if (!response) return null;
  return (
    <div className="space-y-4">
      <ToolTimeline toolCalls={response.tool_calls ?? []} />
      <Markdown>{response.analysis}</Markdown>
      <FollowUpChips
        actions={response.follow_up_actions ?? []}
        onPick={onFollowUp}
        disabled={busy}
      />
      <CostFooter response={response} model={entry.model} />
    </div>
  );
}
