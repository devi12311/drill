"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "./markdown";
import { ToolTimeline } from "./tool-timeline";
import { ApprovalCard } from "./approval-card";
import { StoppedNotice } from "./turn-card";
import type {
  FollowUpAction,
  HolmesChatResponse,
  ToolApprovalDecision,
  ToolCall,
} from "@/lib/holmes/types";
import { useSkillBuilder } from "@/components/skills/use-skill-builder";
import { FETCH_SKILL_TOOL_NAME } from "@/lib/skills/prompt";
import type { MessageSkill } from "@/lib/skills/types";

export interface ChatEntry {
  id: string;
  role: "user" | "assistant";
  /** user entries */
  ask?: string;
  /** user entries: the skill the line ran explicitly */
  skill?: MessageSkill;
  /** assistant entries */
  response?: HolmesChatResponse & { drill_duration_ms?: number };
  error?: string;
  model?: string;
}

/** User ask rendered as a terminal command line (DESIGN.md brew-chip voice). */
export function UserMessage({ ask, skill }: { ask: string; skill?: MessageSkill }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="mt-1 size-2 shrink-0 translate-y-[-1px] rounded-full bg-prompt-green" />
      <div className="min-w-0 flex-1">
        {skill && <SkillTag label="Ran skill" name={skill.name} />}
        <p className="font-mono text-body whitespace-pre-wrap break-words text-warm-off-white">
          {ask}
        </p>
      </div>
    </div>
  );
}

function SkillTag({ label, name }: { label: string; name: string }) {
  return (
    <div className="mb-1.5 text-caption-tracked uppercase text-bone-gray">
      {label} · <span className="font-mono normal-case tracking-normal text-pale-stone">{name}</span>
    </div>
  );
}

/** Skills Holmes fetched on its own during the turn (failed fetches excluded). */
function fetchedSkills(toolCalls: ToolCall[]): string[] {
  const names = toolCalls
    .filter((c) => c.tool_name === FETCH_SKILL_TOOL_NAME && c.result?.status === "success")
    .map((c) => String((c.result.params as { skill_name?: unknown } | null)?.skill_name ?? ""))
    .filter(Boolean);
  return [...new Set(names)];
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

/**
 * An analysis folded to its first lines while steps are picked, so the
 * conversation reads as its calls; "show more" opens one message at a time.
 */
function FoldedAnalysis({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && !open) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [text, open]);
  return (
    <div>
      <div ref={ref} className={open ? undefined : "max-h-[4.5em] overflow-hidden"}>
        <Markdown>{text}</Markdown>
      </div>
      {(overflows || open) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 text-body-sm text-bone-gray underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
        >
          {open ? "show less" : "show more"}
        </button>
      )}
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
  onDecide,
  busy,
  isLatest,
}: {
  entry: ChatEntry;
  onFollowUp: (action: FollowUpAction) => void;
  onDecide: (decisions: ToolApprovalDecision[]) => void;
  busy: boolean;
  /** Only the latest entry's pending approval can still be answered. */
  isLatest: boolean;
}) {
  // While picking steps, only the calls and their context matter.
  const picking = useSkillBuilder() !== null;
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
  if (response.drill_error) {
    // A stopped turn the user moved on from: what it gathered stays readable.
    const toolCalls = response.tool_calls ?? [];
    return (
      <div className="space-y-4">
        <ToolTimeline toolCalls={toolCalls} messageId={entry.id} />
        <StoppedNotice
          error={response.drill_error}
          cancelled={response.drill_error.startsWith("Stopped")}
          savedResults={toolCalls.filter((c) => c.tool_name !== "TodoWrite").length}
        />
      </div>
    );
  }
  const usedSkills = fetchedSkills(response.tool_calls ?? []);
  return (
    <div className="space-y-4">
      {usedSkills.length > 0 && <SkillTag label="Used skill" name={usedSkills.join(", ")} />}
      <ToolTimeline toolCalls={response.tool_calls ?? []} messageId={entry.id} />
      {picking ? (
        <FoldedAnalysis text={response.analysis} />
      ) : (
        <Markdown>{response.analysis}</Markdown>
      )}
      {!picking && !!response.pending_approvals?.length && (
        <ApprovalCard
          approvals={response.pending_approvals}
          actionable={isLatest && !busy}
          onDecide={onDecide}
        />
      )}
      {!picking && (
        <>
          <FollowUpChips
            actions={response.follow_up_actions ?? []}
            onPick={onFollowUp}
            disabled={busy}
          />
          <CostFooter response={response} model={entry.model} />
        </>
      )}
    </div>
  );
}
