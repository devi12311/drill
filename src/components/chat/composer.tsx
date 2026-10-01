"use client";

import { useState } from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export function Composer({
  onSend,
  onStop,
  busy,
  models,
  model,
  onModelChange,
}: {
  /** Resolves false when the question was not sent — the draft is put back. */
  onSend: (ask: string) => Promise<boolean>;
  onStop: () => void;
  /** An investigation is running: Send becomes Stop, typing stays allowed. */
  busy: boolean;
  /** Null while the agent's list is loading. */
  models: string[] | null;
  /** Null until the agent has served at least one model. */
  model: string | null;
  onModelChange: (model: string) => void;
}) {
  const [value, setValue] = useState("");
  const [blocked, setBlocked] = useState(false);

  async function submit() {
    const ask = value.trim();
    if (busy) {
      if (ask) setBlocked(true);
      return;
    }
    if (!ask || !model) return;
    setValue("");
    // Restored only if nothing new was typed meanwhile.
    if (!(await onSend(ask))) setValue((current) => current || ask);
  }

  return (
    <div className="rounded-lg border border-input bg-smoked-onyx focus-within:border-ring/60">
      <textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setBlocked(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        rows={3}
        placeholder="Describe the problem — include trace ids, namespaces, error text…"
        className="w-full resize-none bg-transparent px-4 pt-3 font-mono text-body-sm text-warm-off-white outline-none placeholder:text-bone-gray"
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
              aria-label="Stop the investigation"
              title="Stop the investigation"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              size="icon-sm"
              onClick={submit}
              disabled={!model || !value.trim()}
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
