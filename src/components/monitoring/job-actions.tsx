"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";

/** How long to wait between status checks, growing so a long run stops hammering. */
const POLL_BACKOFF_MS = [3_000, 5_000, 10_000, 15_000, 30_000];

/**
 * Run now / Edit / Delete, and the progress note under them.
 *
 * The polling here replaces a loop that asked
 * `GET /api/admin/monitoring/jobs/[id]` — job, twenty runs and every check
 * override — every five seconds for up to **two hours**: as many as 1 440 requests
 * of four serialised queries each against a five-connection pool, for one run. It
 * also had no `AbortController` and no cleanup, so navigating away left the loop
 * running and `setBusy` firing into an unmounted component.
 *
 * Now: a slim status endpoint, one indexed query, backing off from 3s to 30s,
 * aborted on unmount. And `Edit` and `Delete` are no longer disabled while it runs
 * — the work is server-side, which the note has always said.
 */
export function JobActions({
  clusterId,
  jobId,
  scopeNote,
}: {
  clusterId: string;
  jobId: string;
  /** What this job will investigate, and roughly how long that takes. */
  scopeNote: string;
}) {
  const refresh = useRefreshThenNavigate();
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Anything still in flight belongs to a mounted component, not to a page the
  // operator left five minutes ago.
  useEffect(() => () => abort.current?.abort(), []);

  async function runNow() {
    setRunning(true);
    setError(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch(`/api/admin/monitoring/jobs/${jobId}/run`, {
        method: "POST",
        signal: controller.signal,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);

      for (let attempt = 0; !controller.signal.aborted; attempt++) {
        const wait =
          POLL_BACKOFF_MS[Math.min(attempt, POLL_BACKOFF_MS.length - 1)];
        await new Promise((resolve) => setTimeout(resolve, wait));
        if (controller.signal.aborted) return;
        const poll = await fetch(
          `/api/admin/monitoring/jobs/${jobId}/run-status`,
          { signal: controller.signal },
        );
        if (!poll.ok) break;
        const status = (await poll.json()) as {
          active: boolean;
          error: string | null;
        };
        if (status.active) continue;
        if (status.error) setError(status.error);
        break;
      }
      if (!controller.signal.aborted) refresh(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Run failed");
    } finally {
      if (!controller.signal.aborted) setRunning(false);
    }
  }

  async function remove() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/monitoring/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Deliberately still busy: the button is about to be unmounted.
      refresh(`/admin/monitoring/${clusterId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-3">
        <Button onClick={runNow} disabled={running}>
          <Play className="size-3.5" />
          {running ? "Investigating…" : "Run now"}
        </Button>
        <Button variant="outline" asChild>
          <Link href={`/admin/monitoring/${clusterId}/jobs/${jobId}/edit`}>
            <Pencil className="size-3.5" />
            Edit
          </Link>
        </Button>
        <ConfirmButton
          label="Delete job"
          title="Delete this job?"
          description="Its entire concern history goes with it — every finding this job has ever recorded, and the trend behind them. The runs cannot be reconstructed."
          confirmLabel="Delete job"
          destructive
          disabled={deleting}
          onConfirm={remove}
        >
          <Trash2 className="size-3.5" />
        </ConfirmButton>
      </div>

      {/* Rendered by the header's sibling slot below, so it spans the page. */}
      {(running || error) && (
        <div className="w-full space-y-3">
          {running && (
            <Card className="p-4">
              <p className="text-body-sm text-pale-stone">
                {scopeNote} The work runs on the server, so leaving the page does
                not cancel it — come back and the run will be in the list below.
              </p>
            </Card>
          )}
          {error && <p className="text-body-sm text-traffic-red">{error}</p>}
        </div>
      )}
    </>
  );
}
