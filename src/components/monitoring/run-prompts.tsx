"use client";

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export interface RunPromptEntry {
  index: number;
  target: string;
  bytes: number;
}

/**
 * The verbatim prompts a run sent, fetched one at a time.
 *
 * They used to travel with the run payload and be rendered into a `<pre>` up
 * front — every one of them, whether or not a `<details>` was ever opened. A deep
 * run over ten workloads is ten prompts of roughly twenty kilobytes each: a
 * couple of hundred kilobytes serialised, parsed and held in the DOM so that
 * nobody could look at it. `<details>` hides content; it does not avoid paying
 * for it.
 */
export function RunPrompts({
  runId,
  entries,
}: {
  runId: string;
  entries: RunPromptEntry[];
}) {
  return (
    <>
      {entries.map((entry) => (
        <PromptDisclosure key={entry.index} runId={runId} entry={entry} />
      ))}
    </>
  );
}

function PromptDisclosure({
  runId,
  entry,
}: {
  runId: string;
  entry: RunPromptEntry;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    // Fetched once and kept: a prompt is immutable, so re-opening is free.
    if (text !== null || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/monitoring/runs/${runId}/prompts/${entry.index}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setText(body.prompt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the prompt");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details
      className="rounded-lg border border-border"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open) load();
      }}
    >
      <summary className="cursor-pointer px-4 py-2 text-body-sm text-pale-stone transition-colors hover:bg-smoke-charcoal hover:text-warm-off-white">
        {entry.target}
        <span className="ml-2 text-caption-tracked text-bone-gray">
          {Math.max(1, Math.round(entry.bytes / 1024))} KB
        </span>
      </summary>
      <div className="border-t border-border px-4 py-3">
        {error ? (
          <p className="text-body-sm text-traffic-red">{error}</p>
        ) : text === null ? (
          <div className="space-y-2">
            <Skeleton className="h-3" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        ) : (
          <pre className="max-h-[420px] overflow-auto font-mono text-[12px] whitespace-pre-wrap text-bone-gray">
            {text}
          </pre>
        )}
      </div>
    </details>
  );
}
