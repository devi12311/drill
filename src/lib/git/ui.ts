import type { BranchSyncState } from "./types";

/** Client-safe presentation of sync state — shared by the tree, tables and badges. */

export const SYNC_LABEL: Record<BranchSyncState, string> = {
  queued: "queued",
  syncing: "indexing",
  ok: "synced",
  error: "failed",
};

export const SYNC_DOT: Record<BranchSyncState, string> = {
  queued: "bg-bone-gray",
  syncing: "bg-traffic-yellow",
  ok: "bg-traffic-green",
  error: "bg-traffic-red",
};

export const SYNC_TEXT: Record<BranchSyncState, string> = {
  queued: "text-bone-gray",
  syncing: "text-traffic-yellow",
  ok: "text-traffic-green",
  error: "text-traffic-red",
};

const SEVERITY: BranchSyncState[] = ["error", "syncing", "queued", "ok"];

/** A repository's state at a glance: its worst branch (a failure outranks work in progress). */
export function rollupState(states: BranchSyncState[]): BranchSyncState {
  return SEVERITY.find((s) => states.includes(s)) ?? "queued";
}

export const shortSha = (sha: string | null) => (sha ? sha.slice(0, 7) : "—");
