"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import Link from "next/link";
import { ArrowUp, ChevronDown, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { fuzzyFilter } from "@/lib/fuzzy";
import { withViewTransition } from "@/components/ui/view-transition";
import { parseInvocationLine } from "@/lib/skills/prompt";
import type { SkillView } from "@/lib/skills/types";
import { cn } from "@/lib/utils";
import {
  ANSWER_MODE_HINT,
  ANSWER_MODE_LABEL,
  ANSWER_MODES,
  type AnswerMode,
} from "@/lib/chat/answer-style";

const MAX_SUGGESTIONS = 8;

interface Suggestion {
  skill: SkillView;
  /** Name characters the query matched, for highlighting. */
  positions: number[];
}

/**
 * While the draft is a bare `/partial-name` (no skill picked yet), the skills it
 * could mean, fuzzy-ranked like an IDE file picker: `/cointpro` finds
 * cost-integration-problems.
 */
function slashMatches(value: string, skills: SkillView[] | null): Suggestion[] | null {
  const query = value.match(/^\/([\w-]*)$/)?.[1];
  if (query === undefined || !skills) return null;
  return fuzzyFilter(query, skills, (s) => s.name)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ item, positions }) => ({ skill: item, positions }));
}

function HighlightedName({ name, positions }: { name: string; positions: number[] }) {
  const hit = new Set(positions);
  return (
    <>
      {[...name].map((ch, i) => (
        <span key={i} className={hit.has(i) ? "text-gold-leaf" : undefined}>
          {ch}
        </span>
      ))}
    </>
  );
}

/** An explicit skill run: the picked skill and the values typed for its inputs. */
export interface SkillRun {
  skill: SkillView;
  values: Record<string, string>;
}

const DRAFT_PREFIX = "drill.draft.";

/**
 * The unsent text, per conversation, for this tab: the chat pane remounts when
 * the user opens Skills or Resolutions, and a half-written question must not go
 * with it. Storage can be unavailable (private mode, blocked site data).
 */
function readDraft(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    return sessionStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(DRAFT_PREFIX + key, value);
    else sessionStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Not persisting a draft is a lost convenience, never an error.
  }
}

/** What the page around the composer may do to it. */
export interface ComposerHandle {
  /** Replace the draft with `text` and focus it, selecting `select` (e.g. a placeholder to type over). */
  fill: (text: string, select?: string) => void;
  /**
   * Pick `skill` to run (Run ▸ on a skill page), keeping whatever was typed as
   * its extra context, and focus its first input.
   */
  run: (skill: SkillView) => void;
}

export function Composer({
  ref,
  onSend,
  onStop,
  busy,
  stopping = false,
  status,
  models,
  model,
  onModelChange,
  answerMode,
  onAnswerModeChange,
  skills,
  draftKey,
  animateSend = false,
}: {
  ref?: Ref<ComposerHandle>;
  /**
   * Resolves false when nothing was sent — the draft is put back. With `run`,
   * `ask` is optional extra context for the skill.
   */
  onSend: (ask: string, run?: SkillRun) => Promise<boolean>;
  onStop: () => void;
  /** An investigation is running: Send becomes Stop, typing stays allowed. */
  busy: boolean;
  /** Stop was pressed and the investigation has not stopped yet. */
  stopping?: boolean;
  /** What the running investigation is doing — shown on top, beside its Stop. */
  status?: ReactNode;
  /** Null while the agent's list is loading. */
  models: string[] | null;
  /** Null until the agent has served at least one model. */
  model: string | null;
  onModelChange: (model: string) => void;
  /** How the next answer is written (lib/chat/answer-style.ts). */
  answerMode: AnswerMode;
  onAnswerModeChange: (mode: AnswerMode) => void;
  /** Skills that can be run explicitly here; null while loading. */
  skills: SkillView[] | null;
  /** Where the unsent text is kept: the conversation id, or `new:<agentId>`. */
  draftKey: string;
  /**
   * Send as a view transition: the draft is cleared and the turn queued inside
   * the browser's snapshot, so the page around can animate the hand-off.
   */
  animateSend?: boolean;
}) {
  const [value, setValue] = useState(() => readDraft(draftKey));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const runPanelRef = useRef<HTMLDivElement>(null);
  // An animated send waits a frame for the snapshot, with the draft still in
  // the box; a second Enter in that frame must not send it twice.
  const sendQueued = useRef(false);
  // Sending clears `value`, which clears the stored draft; a send that is put
  // back restores it. A picked skill is not kept — it may be stale on return.
  useEffect(() => writeDraft(draftKey, value), [draftKey, value]);
  const [blocked, setBlocked] = useState(false);
  const [run, setRun] = useState<SkillRun | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Esc hides the list for the draft it was pressed on; typing brings it back.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const suggestions =
    run || dismissedFor === value ? null : slashMatches(value, skills);
  const active = suggestions?.length ? Math.min(highlight, suggestions.length - 1) : 0;

  useImperativeHandle(ref, () => ({
    fill(text, select) {
      setRun(null);
      setValue(text);
      const at = select ? text.indexOf(select) : -1;
      const [from, to] = at >= 0 ? [at, at + (select?.length ?? 0)] : [text.length, text.length];
      // After the commit, so the selection lands on the new value, not the old.
      requestAnimationFrame(() => {
        textareaRef.current?.focus();
        textareaRef.current?.setSelectionRange(from, to);
      });
    },
    run(skill) {
      setRun({ skill, values: {} });
      setHighlight(0);
      requestAnimationFrame(() =>
        (runPanelRef.current?.querySelector("input") ?? textareaRef.current)?.focus(),
      );
    },
  }));

  function pick(skill: SkillView, values: Record<string, string> = {}, note = "") {
    setRun({ skill, values });
    setValue(note);
    setHighlight(0);
  }
  const missing =
    run?.skill.inputs.filter((i) => i.required && !run.values[i.key]?.trim()) ?? [];
  const ready = run ? missing.length === 0 : value.trim() !== "";

  async function submit() {
    // A fully typed `/skill key=value …` runs like a picked one. Missing a
    // required input, it opens the inputs panel with what was typed instead.
    const typed = !run && skills ? parseInvocationLine(value, skills) : null;
    if (typed) {
      const lacking = typed.skill.inputs.some((i) => i.required && !typed.values[i.key]);
      if (lacking || busy) {
        pick(typed.skill, typed.values, typed.note);
        if (busy) setBlocked(true);
        return;
      }
    }
    const ask = typed ? typed.note : value.trim();
    const skillRun = typed ? { skill: typed.skill, values: typed.values } : run;
    if (busy) {
      if (ask || run) setBlocked(true);
      return;
    }
    if (!(typed || ready) || !model || sendQueued.current) return;
    const send = () => {
      sendQueued.current = false;
      setValue("");
      return onSend(ask, skillRun ?? undefined);
    };
    sendQueued.current = true;
    const sent = await (animateSend ? withViewTransition(send) : send());
    // Restored only if nothing new was typed meanwhile; the skill stays picked
    // until a run actually goes out.
    if (sent) setRun(null);
    else setValue((current) => current || (typed ? value : ask));
  }

  return (
    <div
      data-composer
      className="relative rounded-lg border border-input bg-smoked-onyx focus-within:border-ring/60"
    >
      {suggestions && (
        <div
          role="listbox"
          aria-label="Skills"
          className="absolute inset-x-0 bottom-full mb-2 overflow-hidden rounded-lg border border-border bg-smoke-charcoal"
        >
          {suggestions.length === 0 ? (
            <div className="px-4 py-2.5 text-body-sm text-bone-gray">
              {skills?.length ? "No skill matches." : "No skills yet."}{" "}
              <Link href="/skills" className="text-pale-stone hover:text-warm-off-white">
                Manage skills
              </Link>
            </div>
          ) : (
            suggestions.map(({ skill, positions }, i) => (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-selected={i === active}
                // mousedown, not click: keeps focus in the textarea
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(skill);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-baseline gap-3 px-4 py-2 text-left",
                  i === active && "bg-iron-veil",
                )}
              >
                <span className="shrink-0 font-mono text-[13px] text-warm-off-white">
                  /<HighlightedName name={skill.name} positions={positions} />
                </span>
                <span className="truncate text-[12px] text-bone-gray">{skill.description}</span>
              </button>
            ))
          )}
          <div className="border-t border-border px-4 py-1.5 text-[11px] text-bone-gray">
            ↑↓ to choose · Enter or Tab to pick · Esc to close · or type{" "}
            <span className="font-mono">/name key=value</span> and send ·{" "}
            <Link href="/skills" className="text-pale-stone hover:text-warm-off-white">
              Manage skills
            </Link>
          </div>
        </div>
      )}
      {status && <div className="border-b border-border/60 pb-2.5">{status}</div>}
      {run && (
        <div
          ref={runPanelRef}
          // Esc from an input field drops the pick, as it does from the draft.
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            setRun(null);
            textareaRef.current?.focus();
          }}
          className="space-y-2.5 border-b border-border px-4 pb-3 pt-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-body-sm text-warm-off-white">
              /{run.skill.name}
            </span>
            <button
              type="button"
              onClick={() => setRun(null)}
              aria-label="Do not run the skill"
              title="Do not run the skill (Esc)"
              className="rounded-sm p-1 text-bone-gray hover:text-warm-off-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
          {run.skill.inputs.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {run.skill.inputs.map((input) => (
                <Input
                  key={input.key}
                  value={run.values[input.key] ?? ""}
                  onChange={(e) =>
                    setRun({ ...run, values: { ...run.values, [input.key]: e.target.value } })
                  }
                  placeholder={input.required ? input.label : `${input.label} (optional)`}
                  aria-label={input.label}
                  className="font-mono text-[13px]"
                />
              ))}
            </div>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        data-composer-draft
        // `/` from anywhere on the page lands here (see FocusInputShortcut).
        data-shortcut-focus
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setBlocked(false);
          setHighlight(0);
        }}
        onKeyDown={(e) => {
          if (suggestions?.length) {
            const move = { ArrowDown: 1, ArrowUp: -1 }[e.key];
            if (move) {
              e.preventDefault();
              setHighlight((active + move + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
              e.preventDefault();
              pick(suggestions[active].skill);
              return;
            }
          }
          if (e.key === "Escape" && suggestions) {
            e.preventDefault();
            setDismissedFor(value);
            return;
          }
          if (e.key === "Escape" && run) {
            // Esc undoes the pick that Enter made; whatever was typed stays.
            e.preventDefault();
            setRun(null);
            return;
          }
          if (e.key === "Backspace" && run && value === "") {
            // Backspace on an empty draft undoes the pick, like deleting a chip.
            setRun(null);
            return;
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        // One line at rest; field-sizing grows it with pasted logs/traces up to
        // the cap, then it scrolls (browsers without field-sizing just scroll).
        rows={1}
        placeholder={
          run
            ? "Anything else Holmes should know (optional)…"
            : "Describe the problem — or type / to run a skill…"
        }
        className="field-sizing-content max-h-48 w-full resize-none bg-transparent px-4 pb-1 pt-3 font-mono text-body-sm text-warm-off-white outline-none placeholder:text-bone-gray"
      />
      <div className="flex items-center justify-between px-3 pb-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-[12px] text-pale-stone hover:bg-iron-veil hover:text-warm-off-white">
            {model ?? (models ? "no models available" : "loading models…")}
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {(models ?? []).map((m) => (
              <DropdownMenuItem
                key={m}
                onSelect={() => onModelChange(m)}
                className="font-mono text-[13px]"
              >
                {m}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div role="group" aria-label="Answer style" className="ml-1 mr-auto flex items-center">
          {ANSWER_MODES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={answerMode === option}
              title={ANSWER_MODE_HINT[option]}
              onClick={() => onAnswerModeChange(option)}
              className="rounded-sm px-2 py-1 font-mono text-[12px] text-bone-gray hover:text-warm-off-white aria-pressed:bg-iron-veil aria-pressed:text-warm-off-white"
            >
              {ANSWER_MODE_LABEL[option].toLowerCase()}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          {blocked && busy && (
            <span className="text-[12px] text-bone-gray">
              Holmes is still investigating — Stop it or wait.
            </span>
          )}
          {busy ? (
            <Button
              size="icon-sm"
              variant="secondary"
              onClick={onStop}
              disabled={stopping}
              aria-label={stopping ? "Stopping the investigation" : "Stop the investigation"}
              title={stopping ? "Stopping…" : "Stop the investigation"}
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!model || !(ready || value.trim().startsWith("/"))}
              title={missing.length ? `Fill in ${missing.map((i) => i.label).join(", ")}` : undefined}
              aria-label="Send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
