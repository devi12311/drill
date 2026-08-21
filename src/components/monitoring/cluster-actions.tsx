"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";

/**
 * The cluster page's two mutating buttons, split out so the page around them can
 * be a server component. Both re-render the page through `refresh()` rather than
 * refetching a JSON payload the server just produced.
 */
export function RescanButton({ clusterId }: { clusterId: string }) {
  const refresh = useRefreshThenNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function discover() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/monitoring/clusters/${clusterId}/discover`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // One invalidation, not two: this re-renders the page AND the tree, which
      // shows the cluster's discovery error.
      refresh(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={discover} disabled={busy}>
        <RefreshCw className="size-3.5" />
        {busy ? "Scanning…" : "Rescan workloads"}
      </Button>
      {error && (
        <span role="alert" className="text-body-sm text-traffic-red">
          {error}
        </span>
      )}
    </>
  );
}

export function DeleteClusterButton({ clusterId }: { clusterId: string }) {
  const refresh = useRefreshThenNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/monitoring/clusters/${clusterId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Deliberately still busy: the button is about to be unmounted.
      refresh("/admin/monitoring");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <ConfirmButton
        label={busy ? "Deleting…" : "Delete cluster"}
        title="Delete this cluster?"
        description="Its monitoring jobs and their entire concern history go with it. The cluster itself is untouched."
        confirmLabel="Delete cluster"
        destructive
        disabled={busy}
        onConfirm={remove}
      />
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
    </div>
  );
}
