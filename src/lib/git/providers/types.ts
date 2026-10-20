import type { RemoteRepo } from "@/lib/git/types";

/** What a connection authenticates with — the opened (decrypted) token, server-side only. */
export interface ConnectionCredentials {
  account: string;
  token: string;
  /** Bitbucket: Atlassian account email when the token is an Atlassian API token. */
  username: string | null;
}

/** Username/password git presents over HTTPS — what the gateway receives per sync. */
export interface CloneAuth {
  username: string;
  password: string;
}

/**
 * One git hosting provider. The registry (./index.ts) is the seam: OAuth or a
 * GitHub App later is another credential kind behind this same interface, and the
 * routes, lane and UI never branch on the provider.
 */
export interface GitProviderClient {
  /** Prove the credentials can list the account's repositories; throws a human-readable reason. */
  validate(creds: ConnectionCredentials): Promise<void>;
  listRepos(
    creds: ConnectionCredentials,
    opts: { query?: string; page: number },
  ): Promise<{ repos: RemoteRepo[]; hasMore: boolean }>;
  /** Canonical metadata for one repo — what Drill stores, never what a browser sent. */
  getRepo(creds: ConnectionCredentials, fullName: string): Promise<RemoteRepo & { cloneUrl: string }>;
  /** Branch names for a picker — matching `query` when given, at most ~100. */
  listBranches(creds: ConnectionCredentials, fullName: string, query?: string): Promise<string[]>;
  /** Exact existence check — not bounded by the picker's page size. */
  hasBranch(creds: ConnectionCredentials, fullName: string, branch: string): Promise<boolean>;
  cloneAuth(creds: ConnectionCredentials): CloneAuth;
}

class ProviderError extends Error {
  readonly notFound: boolean;
  constructor(message: string, notFound = false) {
    super(message);
    this.notFound = notFound;
  }
}

/** Provider calls are interactive (forms, pickers): bounded, unlike the Holmes path. */
const PROVIDER_TIMEOUT_MS = 15_000;

/** A GET whose 404 means "no such thing" rather than an error. */
export async function providerExists(url: string, init: RequestInit, what: string): Promise<boolean> {
  try {
    await providerFetch(url, init, what);
    return true;
  } catch (err) {
    if (err instanceof ProviderError && err.notFound) return false;
    throw err;
  }
}

export async function providerFetch(url: string, init: RequestInit, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(`Could not reach ${what}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? "the token was rejected (expired, revoked or mistyped)"
        : res.status === 403
          ? "the token lacks permission (check its scopes / repository access)"
          : res.status === 404
            ? "not found, or not visible to this token"
            : body.slice(0, 200) || res.statusText;
    throw new ProviderError(`${what} answered ${res.status}: ${hint}`, res.status === 404);
  }
  return res.json();
}

/** `owner/name` with no path tricks — it is interpolated into provider API URLs. */
export function isFullName(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) && !value.includes("..");
}

/** A branch name as URL path segments: `/` stays a separator (release/1.2), the rest is escaped. */
export const branchPath = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");
