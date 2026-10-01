"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";

/**
 * Run now / Edit / Delete.
 *
 * "Run now" only enqueues: the worker executes the run, and the page — refreshed
 * here — renders the progress banner from the server. Keeping "is it running" out
 * of this component's state is the point; that state used to exist only in the tab
 * that pressed the button, so a reload showed an idle job and a second press got a
 * 409.
 */
export function JobActions({
  clusterId,
  jobId,
  active,
}: {
  clusterId: string;
  jobId: string;
  /** A run is queued or running; the banner below owns it. */
  active: boolean;
}) {
  const refresh = useRefreshThenNavigate();
  const [starting, setStarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runNow() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/jobs/${jobId}/run`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      // 409 means a run is already going — the refresh shows it.
      if (!res.ok && res.status !== 409)
        throw new Error(body.error ?? `HTTP ${res.status}`);
      refresh(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the run");
    } finally {
      setStarting(false);
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
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <Button onClick={runNow} disabled={starting || active}>
          <Play className="size-3.5" />
          {active ? "Run in progress" : "Run now"}
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
          description={
            active
              ? "The run in progress is stopped and discarded with it. Its entire concern history goes too — every finding this job has ever recorded, and the trend behind them."
              : "Its entire concern history goes with it — every finding this job has ever recorded, and the trend behind them. The runs cannot be reconstructed."
          }
          confirmLabel="Delete job"
          destructive
          disabled={deleting}
          onConfirm={remove}
        >
          <Trash2 className="size-3.5" />
        </ConfirmButton>
      </div>
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
    </div>
  );
}
