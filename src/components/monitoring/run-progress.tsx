"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Square } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { formatDuration } from "@/lib/admin/format";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import type { RunProgress as Progress } from "@/lib/db/monitoring-queries";

/** Between status checks, growing so a five-hour deep run is not polled every 3s. */
const POLL_BACKOFF_MS = [3_000, 5_000, 10_000, 15_000];

/**
 * A worker heartbeats every 20s; this much silence is worth telling the operator
 * about, well before the reaper's two minutes.
 */
const QUIET_WORKER_MS = 60_000;
/** A queued run nobody claims is most likely a deploy with no worker at all. */
const UNCLAIMED_MS = 30_000;

/**
 * The banner for a queued or running run: where it is, how long it has taken,
 * and a way to stop it.
 *
 * Server-rendered with its first reading (`initial`), so it is there on a reload or
 * a return visit rather than only in the tab that pressed "Run now". It polls the
 * run's status and refreshes the page once the run ends, which is what swaps the
 * banner for the results.
 */
export function RunProgress({
  runId,
  initial,
  runHref,
  note,
}: {
  runId: string;
  initial: Progress;
  /** Set on the job page, so the banner links to the run in progress. */
  runHref?: string;
  /** What this job investigates and roughly how long that takes. */
  note?: string;
}) {
  const refresh = useRefreshThenNavigate();
  const [progress, setProgress] = useState(initial);
  // Seeded from the reading, not `Date.now()`: the server render and hydration
  // would disagree on the elapsed text and on the "no worker" hint it gates.
  const [now, setNow] = useState(() => Date.parse(initial.asOf));
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  // Only the elapsed clock ticks every second; the status poll backs off.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempt = 0;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/monitoring/runs/${runId}/status`, {
          signal: controller.signal,
        });
        if (res.ok) {
          const next = (await res.json()) as Progress;
          setProgress(next);
          if (next.status !== "queued" && next.status !== "running") {
            refresh(null);
            return;
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        // A dropped poll says nothing about the run, which lives on the server —
        // keep asking rather than declaring it over.
      }
      const wait = POLL_BACKOFF_MS[Math.min(attempt++, POLL_BACKOFF_MS.length - 1)];
      timer = setTimeout(poll, wait);
    };
    timer = setTimeout(poll, POLL_BACKOFF_MS[0]);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [runId, refresh]);

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/runs/${runId}/cancel`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.result === "cancelled") refresh(null);
      else setProgress((p) => ({ ...p, cancelRequested: true }));
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setCancelling(false);
    }
  }

  const running = progress.status === "running";
  const startedAt = progress.startedAt ? Date.parse(progress.startedAt) : null;
  const quietFor = progress.heartbeatAt
    ? now - Date.parse(progress.heartbeatAt)
    : 0;

  const headline = running
    ? [
        "Running",
        progress.total > 1 && `${progress.done} of ${progress.total}`,
        progress.current,
        startedAt && formatDuration(now - startedAt),
      ]
        .filter(Boolean)
        .join(" · ")
    : "Queued — waiting for the worker";

  return (
    <Card className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <p
          className={`min-w-0 flex-1 text-body-sm ${running ? "text-traffic-yellow" : "text-pale-stone"}`}
        >
          {progress.cancelRequested ? "Cancelling…" : headline}
        </p>
        {runHref && (
          <Link
            href={runHref}
            className="text-body-sm text-bone-gray hover:text-warm-off-white hover:underline"
          >
            View run
          </Link>
        )}
        <ConfirmButton
          label="Cancel run"
          title="Cancel this run?"
          description={
            running
              ? "The investigation in flight is stopped. Workloads that already finished are kept and reconciled; the rest are recorded as not assessed. What was spent so far is not refunded."
              : "It has not started, so nothing has been spent."
          }
          confirmLabel="Cancel run"
          size="sm"
          disabled={cancelling || progress.cancelRequested}
          onConfirm={cancel}
        >
          <Square className="size-3" />
          Cancel
        </ConfirmButton>
      </div>

      {running && progress.total > 1 && (
        <div className="h-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full bg-traffic-yellow transition-[width]"
            style={{ width: `${(progress.done / progress.total) * 100}%` }}
          />
        </div>
      )}

      <p className="text-body-sm text-bone-gray">
        {progress.cancelRequested
          ? "Stopping the current investigation; finished workloads are kept."
          : `${note ? `${note} ` : ""}It runs on the server — leaving this page does not stop it.`}
      </p>
      {running && quietFor > QUIET_WORKER_MS && (
        <p className="text-body-sm text-traffic-yellow">
          The worker has not reported in {formatDuration(quietFor)}. If it does
          not recover, the run is closed within a few minutes and its finished
          workloads are kept.
        </p>
      )}
      {!running && now - Date.parse(progress.createdAt) > UNCLAIMED_MS && (
        <p className="text-body-sm text-traffic-yellow">
          No worker has picked this up yet. Check that a monitoring worker is
          running (DRILL_ROLE=worker or all).
        </p>
      )}
      {cancelError && (
        <p className="text-body-sm text-traffic-red">{cancelError}</p>
      )}
    </Card>
  );
}
