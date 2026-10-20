/**
 * Shared contracts for the Git module (connected GitHub/Bitbucket accounts, the
 * repositories synced from them, and their branches). Client-safe: the schema, the
 * API routes and the admin UI all speak these types.
 */

export const GIT_PROVIDERS = ["github", "bitbucket"] as const;
export type GitProvider = (typeof GIT_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<GitProvider, string> = {
  github: "GitHub",
  bitbucket: "Bitbucket",
};

/** What `account` means per provider — the owner every repo of the connection lives under. */
export const ACCOUNT_LABEL: Record<GitProvider, string> = {
  github: "Owner (organization or user)",
  bitbucket: "Workspace",
};

export function isGitProvider(value: unknown): value is GitProvider {
  return (GIT_PROVIDERS as readonly unknown[]).includes(value);
}

/**
 * One branch's sync lifecycle, as Drill tracks it:
 *  - `queued`  — asked for (Sync button, or a branch just added); waiting for the worker;
 *  - `syncing` — handed to the gateway, which fetches, checks out and indexes it;
 *  - `ok` / `error` — the last attempt's outcome. An `error` keeps the previous
 *    commit and index, which the gateway still serves.
 */
export const BRANCH_SYNC_STATES = ["queued", "syncing", "ok", "error"] as const;
export type BranchSyncState = (typeof BRANCH_SYNC_STATES)[number];

export const ACTIVE_SYNC_STATES: readonly BranchSyncState[] = ["queued", "syncing"];

export interface IndexStats {
  files: number;
  nodes: number;
  edges: number;
  dbSizeBytes: number;
  languages: string[];
}

/** A repository as the provider lists it, before (or after) it is added to Drill. */
export interface RemoteRepo {
  externalId: string;
  /** `owner/name` / `workspace/slug`. */
  fullName: string;
  name: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string | null;
}

/** GitHub owner / Bitbucket workspace slug — interpolated into provider API paths. */
export function isAccountName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value) && !value.includes("..");
}

/** The agent-facing repository name: a slug or `owner/slug`. */
export function isRepoName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)?$/.test(value) && value.length <= 200;
}

/**
 * A branch name the gateway will accept. Mirrors `isBranchName` in
 * codegraph-gateway/src/validate.ts — checked here too so the admin gets the
 * error on save, not as a failed sync later.
 */
export function isBranchName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    /^[A-Za-z0-9._/-]+$/.test(value) &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.endsWith(".lock") &&
    !value.includes("..") &&
    !value.includes("//")
  );
}
