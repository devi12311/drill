"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Copy `value` to the clipboard, reading "Copied" until the value changes. */
export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copiedValue, setCopiedValue] = useState<string | null>(null);
  // Keyed on the value, so a freshly created link never reads "Copied".
  const copied = copiedValue === value;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={() => navigator.clipboard.writeText(value).then(() => setCopiedValue(value))}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** A one-time link (invite, share) in a code box, with Copy. */
export function CopyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-sm border border-border bg-deep-ember px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-pale-stone">{value}</code>
      <CopyButton value={value} />
    </div>
  );
}
