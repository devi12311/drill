"use client";

import { CopyButton } from "@/components/ui/copy-field";

/**
 * A fenced block in an answer: a terminal panel (DESIGN.md: Terminal Product
 * Mockup — #383838 chrome bar over a #2f2f2f body) whose bar carries the
 * language and Copy, so a fix is one click from the clipboard.
 */
export function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  return (
    <div className="overflow-hidden rounded-lg bg-smoke-charcoal">
      <div className="flex items-center justify-between bg-iron-veil py-0.5 pl-4 pr-1">
        <span className="font-mono text-[11px] text-bone-gray">{lang ?? "text"}</span>
        <CopyButton value={code} className="h-7 text-[12px] text-pale-stone" />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-warm-off-white">
        <code>{code}</code>
      </pre>
    </div>
  );
}
