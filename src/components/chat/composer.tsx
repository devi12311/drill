"use client";

import { useState } from "react";
import { ArrowUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
export function Composer({
  onSend,
  busy,
  models,
  model,
  onModelChange,
}: {
  onSend: (ask: string) => void;
  busy: boolean;
  /** Null while the agent's list is loading. */
  models: string[] | null;
  /** Null until the agent has served at least one model. */
  model: string | null;
  onModelChange: (model: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const ask = value.trim();
    if (!ask || busy || !model) return;
    setValue("");
    onSend(ask);
  }

  return (
    <div className="rounded-lg border border-input bg-smoked-onyx focus-within:border-ring/60">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
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
        <Button
          size="icon-sm"
          onClick={submit}
          disabled={busy || !model || !value.trim()}
          aria-label="Send"
        >
          <ArrowUp />
        </Button>
      </div>
    </div>
  );
}
