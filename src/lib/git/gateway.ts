import "server-only";
import { SignJWT } from "jose";
import type { IndexStats } from "@/lib/git/types";
import type { CloneAuth } from "@/lib/git/providers/types";

/**
 * Drill's side of the codegraph gateway (codegraph-gateway/). Two jobs:
 *
 *  - the CONTROL API — push an org's manifest, start a branch sync, read status —
 *    authenticated by a short-lived JWT, so the shared secret never crosses the wire;
 *  - the SCOPE header on every Holmes request. Holmes forwards it verbatim to the
 *    gateway's MCP endpoint (`extra_headers` in its mcp_servers config), and the
 *    gateway only ever shows that org's repositories. The model never sees it and
 *    cannot set it — isolation is enforced in code, not by the prompt.
 *
 * Audiences/issuer must match codegraph-gateway/src/auth.ts.
 */

const ISSUER = "drill";
const AUD_CONTROL = "codegraph-gateway/control";
const AUD_SCOPE = "codegraph-gateway/mcp";
const SCOPE_HEADER = "X-Drill-Scope";

/**
 * Outlives the longest single Holmes request Drill makes (a cluster assessment's
 * 45-minute deadline, lib/monitoring/assess.ts) — every resume and every new turn
 * signs a fresh token — and stays under the gateway's one-hour cap, bounding the
 * replay window of a token lifted from in-cluster traffic. A request that still
 * outlives it gets an explicit "expired" from the gateway, not an empty org.
 */
const SCOPE_TTL_S = 50 * 60;
const CONTROL_TTL_S = 60;
const CONTROL_TIMEOUT_MS = 15_000;

interface GatewayConfig {
  url: string;
  key: Uint8Array;
}

function gatewayConfig(): GatewayConfig | null {
  const url = process.env.CODEGRAPH_GATEWAY_URL?.trim();
  const secret = process.env.CODEGRAPH_GATEWAY_SECRET?.trim();
  if (!url || !secret) return null;
  return { url: url.replace(/\/$/, ""), key: new TextEncoder().encode(secret) };
}

/** The module is optional: without a gateway the Git pages explain what to configure. */
export function gitModuleEnabled(): boolean {
  return gatewayConfig() !== null;
}

function sign(cfg: GatewayConfig, audience: string, ttlS: number, claims: Record<string, string> = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlS}s`)
    .sign(cfg.key);
}

/**
 * The header Holmes forwards to the gateway: which org (and which of its agents)
 * this request investigates for. Empty when the module is off, so Holmes requests
 * are byte-for-byte what they were before.
 */
export async function codeScopeHeaders(agent: { id: string; orgId: string }): Promise<Record<string, string>> {
  const cfg = gatewayConfig();
  if (!cfg) return {};
  return { [SCOPE_HEADER]: await sign(cfg, AUD_SCOPE, SCOPE_TTL_S, { org: agent.orgId, agent: agent.id }) };
}

class GatewayError extends Error {}

async function control<T>(method: string, path: string, body?: unknown): Promise<T> {
  const cfg = gatewayConfig();
  if (!cfg) throw new GatewayError("The code index gateway is not configured");
  let res: Response;
  try {
    res = await fetch(`${cfg.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await sign(cfg, AUD_CONTROL, CONTROL_TTL_S)}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(CONTROL_TIMEOUT_MS),
    });
  } catch (err) {
    throw new GatewayError(`Could not reach the code index gateway: ${err instanceof Error ? err.message : String(err)}`);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new GatewayError(`Code index gateway ${res.status}: ${data.error ?? res.statusText}`);
  return data;
}

export interface GatewayManifest {
  agents: string[];
  repos: {
    id: string;
    name: string;
    cloneUrl: string;
    defaultBranchId: string;
    branches: { id: string; name: string }[];
  }[];
}

export interface GatewayBranchStatus {
  state: "idle" | "syncing" | "ok" | "error";
  sha?: string;
  indexedAt?: string;
  stats?: IndexStats;
  error?: string;
  jobId?: string;
}

export const gateway = {
  putManifest: (orgId: string, manifest: GatewayManifest) =>
    control<{ repos: number }>("PUT", `/v1/orgs/${orgId}/manifest`, manifest),

  retainOrgs: (orgIds: string[]) => control<{ dropped: number }>("PUT", "/v1/orgs", { orgs: orgIds }),

  startSync: (orgId: string, repoId: string, branchId: string, auth: CloneAuth) =>
    control<{ jobId: string }>("POST", `/v1/orgs/${orgId}/repos/${repoId}/branches/${branchId}/sync`, auth),

  repoStatus: (orgId: string, repoId: string) =>
    control<{ branches: Record<string, GatewayBranchStatus> }>("GET", `/v1/orgs/${orgId}/repos/${repoId}`),

  async health(): Promise<{ codegraph: string; diskFreeBytes: number }> {
    const cfg = gatewayConfig();
    if (!cfg) throw new GatewayError("The code index gateway is not configured");
    const res = await fetch(`${cfg.url}/healthz`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new GatewayError(`Code index gateway health ${res.status}`);
    return res.json();
  },
};
