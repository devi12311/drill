"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useAdminMutation } from "@/lib/admin/use-admin-mutation";

/**
 * Which org agent investigates this cluster. Moving it is how an agent gets
 * freed for deletion, and how a re-deployed Holmes is picked up; the API proves
 * the new agent answers before saving.
 */
export function ClusterAgentSelect({
  clusterId,
  agentId,
  agents,
}: {
  clusterId: string;
  agentId: string;
  agents: { id: string; name: string }[];
}) {
  const { mutate, busy, error } = useAdminMutation();

  return (
    <>
      <select
        aria-label="Holmes agent for this cluster"
        value={agentId}
        disabled={busy}
        onChange={(e) =>
          mutate(`/api/admin/monitoring/clusters/${clusterId}`, { method: "PATCH", body: { agentId: e.target.value } })
        }
        className="h-7 rounded-sm border border-input bg-transparent px-1.5 font-mono text-[12px] text-pale-stone outline-none focus-visible:border-ring disabled:opacity-50"
      >
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="ml-2 text-traffic-red">
          {error}
        </span>
      )}
    </>
  );
}

/**
 * The cluster page's mutating buttons, split out so the page around them can be a
 * server component. Each re-renders the page — and the tree, which shows the
 * cluster's discovery error — through one refresh, rather than refetching a JSON
 * payload the server just produced.
 */
export function RescanButton({ clusterId }: { clusterId: string }) {
  const { mutate, busy, error } = useAdminMutation();

  return (
    <>
      <Button
        variant="outline"
        onClick={() => mutate(`/api/admin/monitoring/clusters/${clusterId}/discover`, { method: "POST" })}
        disabled={busy}
      >
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
  const { mutate, busy, error } = useAdminMutation();

  return (
    <div className="space-y-2">
      <ConfirmButton
        label={busy ? "Deleting…" : "Delete cluster"}
        title="Delete this cluster?"
        description="Its monitoring jobs and their entire concern history go with it. The cluster itself is untouched."
        confirmLabel="Delete cluster"
        destructive
        disabled={busy}
        onConfirm={() => mutate(`/api/admin/monitoring/clusters/${clusterId}`, { method: "DELETE" }, "/admin/monitoring")}
      />
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}
    </div>
  );
}
