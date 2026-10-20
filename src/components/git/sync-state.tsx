import type { BranchSyncState } from "@/lib/git/types";
import { SYNC_DOT, SYNC_LABEL, SYNC_TEXT } from "@/lib/git/ui";
import { cn } from "@/lib/utils";

/** Dot + word for a branch's (or a repository's rolled-up) sync state. */
export function SyncState({ state }: { state: BranchSyncState }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", SYNC_TEXT[state])}>
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", SYNC_DOT[state], state === "syncing" && "animate-pulse")}
      />
      {SYNC_LABEL[state]}
    </span>
  );
}
