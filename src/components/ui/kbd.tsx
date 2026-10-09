"use client";

import { Fragment } from "react";
import { useIsMac } from "@/components/shell/shortcuts";
import { comboSteps, stepLabels } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";

/** One key cap: Geist Mono on a flat, hairline-bordered chip (no bevel, no shadow). */
export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-smoke-charcoal px-1.5 font-mono text-[11px] leading-none text-pale-stone",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** A whole combo as key caps — `mod+shift+o` → ⌘ ⇧ O, a chord `g r` → G then R. */
export function KeyCombo({ keys, className }: { keys: string; className?: string }) {
  const mac = useIsMac();
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {comboSteps(keys).map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="px-0.5 text-[11px] text-bone-gray">then</span>}
          {stepLabels(step, mac).map((label) => (
            <Kbd key={label}>{label}</Kbd>
          ))}
        </Fragment>
      ))}
    </span>
  );
}
