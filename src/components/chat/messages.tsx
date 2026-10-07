"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Markdown } from "./markdown";
import { InvestigationRail } from "./investigation-rail";
import { ApprovalCard } from "./approval-card";
import { StoppedNotice } from "./turn-card";
import type { DecisionView } from "@/lib/chat/describe";
import {
  investigationCost,
  investigationRows,
  type Investigation as InvestigationData,
  type LiveItem,
} from "@/lib/chat/investigations";
import type { ChatEntry } from "@/lib/chat/types";
import type {
  FollowUpAction,
  ToolApprovalDecision,
  ToolCall,
} from "@/lib/holmes/types";
import { useSkillBuilder } from "@/components/skills/use-skill-builder";
import { FETCH_SKILL_TOOL_NAME } from "@/lib/skills/prompt";
import type { MessageSkill } from "@/lib/skills/types";
import { cn } from "@/lib/utils";

/**
 * The chat column, wider once the pane can hold the investigation rail beside
 * the answer (the `rail` variant).
 */
export const CHAT_WIDTH = "mx-auto w-full max-w-[820px] px-6 rail:max-w-[1100px]";

/**
 * Rail beside body. Each investigation and the composer use it, so the composer
 * always lines up with the body it answers into.
 */
export const RAIL_GRID =
  "grid grid-cols-1 rail:grid-cols-[256px_minmax(0,1fr)] rail:gap-x-6";

/** The rail's cell when there is nothing in it — holds the body's column. */
export function RailSpacer() {
  return <div aria-hidden className="hidden rail:block" />;
}

/** The user's question: a message bubble on the right, apart from what Holmes says. */
function UserMessage({ ask, skill }: { ask: string; skill?: MessageSkill }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[75%] min-w-0 flex-col items-end gap-1.5">
        {skill && <SkillTag label="Ran skill" name={skill.name} />}
        <p
          data-ask
          className="rounded-lg bg-smoke-charcoal px-4 py-2.5 text-body-sm whitespace-pre-wrap break-words text-warm-off-white"
        >
          {ask}
        </p>
      </div>
    </div>
  );
}

function SkillTag({ label, name }: { label: string; name: string }) {
  return (
    <div className="text-caption-tracked uppercase text-bone-gray">
      {label} · <span className="font-mono normal-case tracking-normal text-pale-stone">{name}</span>
    </div>
  );
}

/** The person's answer to an approval pause — an event in the investigation, not a question. */
function DecisionLine({ decision }: { decision: DecisionView }) {
  const Icon = decision.approved ? ShieldCheck : ShieldX;
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-body-sm text-bone-gray">
      <Icon className="size-3.5 shrink-0 translate-y-0.5" />
      <span className="shrink-0">
        You {decision.approved ? "approved" : "denied"}{" "}
        <span className="font-mono text-[13px] text-pale-stone">{decision.tool_name}</span>
      </span>
      <span className="min-w-0 truncate font-mono text-[12px]" title={decision.description}>
        {decision.description}
      </span>
      {decision.feedback && (
        <span className="min-w-0 truncate italic">— {decision.feedback}</span>
      )}
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

function CostFooter({ inv }: { inv: InvestigationData }) {
  const { cost, tokens, ms, model } = investigationCost(inv);
  if (cost == null && tokens == null) return null;
  const parts: string[] = [];
  if (model) parts.push(model);
  if (cost != null) parts.push(`$${cost.toFixed(4)}`);
  if (tokens != null) parts.push(`${tokens.toLocaleString()} tok`);
  if (ms != null) parts.push(`${Math.round(ms / 1000)}s`);
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

function FollowUpChips({
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

/** One stored answer inside an investigation: its analysis, or why it stopped. */
function AnswerPart({
  entry,
  picking,
  approval,
}: {
  entry: ChatEntry;
  picking: boolean;
  /** The pause's approval prompt, when this answer is the one waiting. */
  approval?: ReactNode;
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
  if (response.drill_error) {
    // A stopped turn the user moved on from: what it gathered stays in the rail.
    return (
      <StoppedNotice
        error={response.drill_error}
        cancelled={response.drill_error.startsWith("Stopped")}
        savedResults={(response.tool_calls ?? []).filter((c) => c.tool_name !== "TodoWrite").length}
      />
    );
  }
  return (
    <>
      {response.analysis?.trim() &&
        (picking ? (
          <FoldedAnalysis text={response.analysis} />
        ) : (
          <Markdown>{response.analysis}</Markdown>
        ))}
      {!picking && approval}
    </>
  );
}

/** The investigation's turn while it runs — or after it stopped, until Resume or Dismiss. */
interface LiveTurn {
  items: LiveItem[];
  /** The turn in the body: Holmes's latest note, or the stopped notice. */
  card: ReactNode;
  active: boolean;
}

/**
 * A question and everything Holmes did to answer it — approval pauses and the
 * turn still running included — as one rail of plan and calls beside one body.
 */
export function Investigation({
  inv,
  live,
  isLatest,
  busy,
  onFollowUp,
  onDecide,
}: {
  inv: InvestigationData;
  live?: LiveTurn;
  /** Only the latest investigation's pending approval can still be answered. */
  isLatest: boolean;
  busy: boolean;
  onFollowUp: (action: FollowUpAction) => void;
  onDecide: (decisions: ToolApprovalDecision[]) => void;
}) {
  // While picking steps, only the calls and their context matter.
  const picking = useSkillBuilder() !== null;
  const rail = investigationRows(inv, live?.items);
  const answers = inv.parts.flatMap((p) => (p.kind === "answer" ? [p.entry] : []));
  const usedSkills = fetchedSkills(answers.flatMap((e) => e.response?.tool_calls ?? []));
  const last = inv.parts.at(-1);
  // The answer that closed the investigation — where its follow-ups and cost go.
  const final =
    !live && last?.kind === "answer" && last.entry.response && !last.entry.response.drill_error
      ? last.entry.response
      : null;

  return (
    // Narrow: question, then the work, then the answer. Wide: the rail spans
    // both rows beside them, so it starts level with the question — and the
    // body row is `1fr`, so a tall rail lengthens it, not the question's row
    // (which would push the answer further down with every call).
    <div className={cn(RAIL_GRID, "gap-y-4 rail:grid-rows-[auto_1fr]")}>
      {inv.question && (
        <div className="min-w-0 rail:col-start-2">
          <UserMessage ask={inv.question.ask!} skill={inv.question.skill} />
        </div>
      )}
      {(rail.rows.length > 0 || rail.todos || live?.active) && (
        // Placed directly, not wrapped: a sticky box only travels within its parent.
        <InvestigationRail
          data={rail}
          live={live?.active}
          stopped={!!live && !live.active}
          className="rail:col-start-1 rail:row-span-2 rail:row-start-1"
        />
      )}
      <div className="min-w-0 space-y-5 rail:col-start-2">
        {usedSkills.length > 0 && <SkillTag label="Used skill" name={usedSkills.join(", ")} />}
        {inv.parts.map((part) =>
          part.kind === "decision" ? (
            part.decisions.map((d, i) => <DecisionLine key={`${part.entry.id}:${i}`} decision={d} />)
          ) : (
            <AnswerPart
              key={part.entry.id}
              entry={part.entry}
              picking={picking}
              approval={
                part === last && !!part.entry.response?.pending_approvals?.length && (
                  <ApprovalCard
                    approvals={part.entry.response.pending_approvals}
                    actionable={isLatest && !busy}
                    onDecide={onDecide}
                  />
                )
              }
            />
          ),
        )}
        {live?.card}
        {final && !picking && (
          <>
            <FollowUpChips
              actions={final.follow_up_actions ?? []}
              onPick={onFollowUp}
              disabled={busy}
            />
            <CostFooter inv={inv} />
          </>
        )}
      </div>
    </div>
  );
}
