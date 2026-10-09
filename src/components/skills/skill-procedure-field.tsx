"use client";

import {
  useDeferredValue,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Plus } from "lucide-react";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/chat/markdown";
import { cn } from "@/lib/utils";
import { placeholdersIn } from "@/lib/templates";
import { SKILL_LIMITS } from "@/lib/skills/types";

export const PROCEDURE_ID = "skill-body";

/** A key an input could have — the only names "Add as input" offers. */
const KEY_SHAPE = /^[a-z][a-z0-9_]{0,31}$/;

/** The `{{partial` being typed just before the caret, if any. */
function openPlaceholder(text: string, caret: number): { start: number; partial: string } | null {
  const match = /\{\{\s*([a-z0-9_]*)$/.exec(text.slice(0, caret));
  return match ? { start: match.index, partial: match[1] } : null;
}

/** Write / Preview, as a real tab set: announced, selected state, arrow keys. */
function ProcedureTabs({
  preview,
  onPreview,
  className,
}: {
  preview: boolean;
  onPreview: (preview: boolean) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = ["Write", "Preview"] as const;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = preview ? 0 : 1;
    onPreview(next === 1);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Procedure view"
      className={cn("flex gap-1", className)}
      onKeyDown={onKeyDown}
    >
      {tabs.map((tab, i) => {
        const selected = preview === (i === 1);
        return (
          <button
            key={tab}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`skill-tab-${tab.toLowerCase()}`}
            aria-selected={selected}
            aria-controls={`skill-panel-${tab.toLowerCase()}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onPreview(i === 1)}
            className={cn(
              "rounded-sm px-2.5 py-1 text-body-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? "bg-iron-veil text-warm-off-white"
                : "text-bone-gray hover:text-warm-off-white",
            )}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The procedure: markdown on the left, what Holmes will read on the right when
 * the column is wide enough (a container query — the editor's column, not the
 * window, decides), Write / Preview tabs when it is not.
 *
 * Typing `{{` offers the skill's input keys, so a placeholder is picked rather
 * than spelled; one the inputs do not define yet is listed with "Add as input",
 * since the save would otherwise refuse it.
 */
export function SkillProcedureField({
  value,
  onChange,
  onBlur,
  error,
  label,
  inputKeys,
  onAddInput,
  preview,
  onPreview,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error?: string;
  label: ReactNode;
  inputKeys: string[];
  onAddInput: (key: string) => void;
  /** Narrow columns only: which of the two tabs shows. */
  preview: boolean;
  onPreview: (preview: boolean) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const [highlight, setHighlight] = useState(0);
  // Esc closes the list for the `{{` it was pressed on; typing on reopens it.
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  // A long procedure re-renders its preview on every keystroke otherwise.
  const shown = useDeferredValue(value);

  const open = caret !== null && caret !== dismissedAt ? openPlaceholder(value, caret) : null;
  const options = open ? inputKeys.filter((k) => k.startsWith(open.partial)) : [];
  const listOpen = options.length > 0;
  const active = Math.min(highlight, options.length - 1);

  const unknown = [...new Set(placeholdersIn(value))].filter(
    (name) => KEY_SHAPE.test(name) && !inputKeys.includes(name),
  );

  const track = () => setCaret(textareaRef.current?.selectionStart ?? null);

  function insert(key: string) {
    if (!open || caret === null) return;
    const after = value.slice(caret);
    const closing = after.startsWith("}}") ? "" : "}}";
    const next = `${value.slice(0, open.start)}{{${key}${closing}${after}`;
    const at = open.start + key.length + 4;
    onChange(next);
    setCaret(at);
    setHighlight(0);
    requestAnimationFrame(() => textareaRef.current?.setSelectionRange(at, at));
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (!listOpen) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setHighlight((active + step + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insert(options[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissedAt(caret);
    }
  }

  return (
    <div className="@container space-y-2">
      <ProcedureTabs preview={preview} onPreview={onPreview} className="@5xl:hidden" />
      <div className="grid gap-4 @5xl:grid-cols-2">
        <div
          id="skill-panel-write"
          role="tabpanel"
          aria-labelledby="skill-tab-write"
          className={cn(preview && "hidden @5xl:block")}
        >
          <Field
            id={PROCEDURE_ID}
            label={label}
            value={value}
            limit={SKILL_LIMITS.body}
            error={error}
            description="Markdown. Type {{ to use an input."
          >
            {(props) => (
              <div className="space-y-1.5">
                <Textarea
                  {...props}
                  ref={textareaRef}
                  value={value}
                  onChange={(e) => {
                    onChange(e.target.value);
                    setCaret(e.target.selectionStart);
                    setDismissedAt(null);
                    setHighlight(0);
                  }}
                  onSelect={track}
                  onKeyDown={onKeyDown}
                  onBlur={() => {
                    setCaret(null);
                    onBlur();
                  }}
                  rows={24}
                  aria-autocomplete="list"
                  aria-controls={listOpen ? "skill-placeholder-list" : undefined}
                  aria-activedescendant={listOpen ? `skill-placeholder-${active}` : undefined}
                  className="font-mono text-[13px] leading-relaxed"
                />
                {listOpen && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-smoked-onyx px-2 py-1.5">
                    <span aria-hidden className="pr-1 text-[12px] text-bone-gray">
                      ↵ insert
                    </span>
                    <ul
                      id="skill-placeholder-list"
                      role="listbox"
                      aria-label="Inputs"
                      className="contents"
                    >
                    {options.map((key, i) => (
                      <li
                        key={key}
                        id={`skill-placeholder-${i}`}
                        role="option"
                        aria-selected={i === active}
                        // mousedown, not click: the textarea must keep its caret.
                        onMouseDown={(e) => {
                          e.preventDefault();
                          insert(key);
                        }}
                        className={cn(
                          "cursor-pointer rounded-sm px-1.5 py-0.5 font-mono text-[12px]",
                          i === active
                            ? "bg-iron-veil text-warm-off-white"
                            : "text-pale-stone hover:text-warm-off-white",
                        )}
                      >
                        {`{{${key}}}`}
                      </li>
                    ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Field>
        </div>
        <div
          id="skill-panel-preview"
          role="tabpanel"
          aria-labelledby="skill-tab-preview"
          className={cn(!preview && "hidden @5xl:block")}
        >
          <div className="min-h-64 overflow-y-auto rounded-lg border border-border px-4 py-3 @5xl:mt-6 @5xl:max-h-[40rem]">
            <Markdown placeholders>{shown || "_Nothing written yet._"}</Markdown>
          </div>
        </div>
      </div>
      {unknown.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-body-sm text-bone-gray">
          Not an input yet:
          {unknown.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onAddInput(name)}
              className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5 font-mono text-[12px] text-pale-stone outline-none hover:border-slate-hearth hover:text-warm-off-white focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Plus className="size-3" />
              {`{{${name}}}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
