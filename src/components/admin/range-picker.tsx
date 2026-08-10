"use client";

import { cn } from "@/lib/utils";

export type Range = "today" | "7d" | "30d" | "90d" | "all";

const OPTIONS: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
];

export function RangePicker({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "rounded-sm px-2.5 py-1 text-body-sm text-bone-gray transition-colors hover:text-warm-off-white",
            value === opt.value &&
              "bg-smoke-charcoal text-warm-off-white",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
