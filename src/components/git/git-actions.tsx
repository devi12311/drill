"use client";

import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { useAdminMutation } from "@/lib/admin/use-admin-mutation";

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <span role="alert" className="text-body-sm text-traffic-red">
      {error}
    </span>
  ) : null;
}

/**
 * Queue a sync. `url` decides the scope (a connection's repos, one repo, or —
 * with `branchId` — one branch); the server skips branches already in flight, so
 * a second click is harmless.
 */
export function SyncButton({
  url,
  branchId,
  label = "Sync",
  compact,
  disabled,
}: {
  url: string;
  branchId?: string;
  label?: string;
  /** Icon-only, for a table row — the label becomes its accessible name. */
  compact?: boolean;
  disabled?: boolean;
}) {
  const { mutate, busy, error } = useAdminMutation();
  return (
    <>
      <Button
        variant={compact ? "ghost" : "outline"}
        size={compact ? "icon-sm" : "default"}
        aria-label={compact ? label : undefined}
        title={compact ? label : undefined}
        disabled={busy || disabled}
        onClick={() => mutate(url, { method: "POST", body: branchId ? { branchId } : undefined })}
      >
        <RefreshCw className={compact && busy ? "size-3.5 animate-spin" : "size-3.5"} />
        {!compact && (busy ? "Queuing…" : label)}
      </Button>
      <ErrorText error={error} />
    </>
  );
}

export function CheckConnectionButton({ connectionId }: { connectionId: string }) {
  const { mutate, busy, error } = useAdminMutation();
  return (
    <>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => mutate(`/api/admin/git/connections/${connectionId}/check`, { method: "POST" })}
      >
        <ShieldCheck className="size-3.5" />
        {busy ? "Checking…" : "Check now"}
      </Button>
      <ErrorText error={error} />
    </>
  );
}

export function DeleteConnectionButton({ connectionId, repoCount }: { connectionId: string; repoCount: number }) {
  const { mutate, busy, error } = useAdminMutation();
  return (
    <div className="space-y-2">
      <ConfirmButton
        label={busy ? "Deleting…" : "Delete connection"}
        title="Delete this connection?"
        description="Drill forgets the token. Nothing changes on the provider."
        confirmLabel="Delete connection"
        destructive
        disabled={busy || repoCount > 0}
        onConfirm={() => mutate(`/api/admin/git/connections/${connectionId}`, { method: "DELETE" }, { leave: "/admin/git" })}
      />
      {repoCount > 0 && (
        <p className="text-body-sm text-bone-gray">Remove its {repoCount} repositories first.</p>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function RemoveRepoButton({ repoId, connectionId }: { repoId: string; connectionId: string }) {
  const { mutate, busy, error } = useAdminMutation();
  return (
    <div className="space-y-2">
      <ConfirmButton
        label={busy ? "Removing…" : "Remove repository"}
        title="Stop syncing this repository?"
        description="Its clone and code index are deleted from the gateway, and the agent can no longer query it. The repository itself is untouched; you can add it again later (it re-indexes from scratch)."
        confirmLabel="Remove repository"
        destructive
        disabled={busy}
        onConfirm={() =>
          mutate(`/api/admin/git/repositories/${repoId}`, { method: "DELETE" }, { leave: `/admin/git/connections/${connectionId}` })
        }
      />
      <ErrorText error={error} />
    </div>
  );
}

export function RemoveBranchButton({ repoId, branchId, branch }: { repoId: string; branchId: string; branch: string }) {
  const { mutate, busy, error } = useAdminMutation();
  return (
    <>
      <ConfirmButton
        label={`Stop tracking ${branch}`}
        title={`Stop tracking ${branch}?`}
        description="Its worktree and index are deleted from the gateway; the agent falls back to the default branch for it."
        confirmLabel="Stop tracking"
        destructive
        variant="ghost"
        size="icon-sm"
        disabled={busy}
        onConfirm={() =>
          mutate(`/api/admin/git/repositories/${repoId}`, { method: "PATCH", body: { removeBranchIds: [branchId] } })
        }
      >
        <X className="size-3.5" />
      </ConfirmButton>
      <ErrorText error={error} />
    </>
  );
}
