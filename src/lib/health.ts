/**
 * Connection health for agents and clusters, from evidence rather than edits.
 *
 * The worker probes every agent (`GET /api/model`: no LLM, no cost) and re-scans
 * every cluster's inventory on the intervals below (lib/health-checks.ts). Each
 * attempt stamps the row: success sets the timestamp and clears the error, a
 * failure records the error. So the status reads:
 *
 *  - `down`    — the last attempt failed (the error says why);
 *  - `ok`      — a successful contact within the stale window;
 *  - `stale`   — no successful contact for several intervals, which means the
 *                checks themselves are not running (worker down), not that the
 *                target is: the UI says "not checked", never "broken".
 *
 * Pure and client-safe: server pages and client components derive it the same way.
 */

export const AGENT_PROBE_MS = 5 * 60_000;
/** Three missed probes. */
export const AGENT_STALE_MS = 4 * AGENT_PROBE_MS;

/** Doubles as the inventory refresh: new and removed workloads appear on their own. */
export const CLUSTER_REFRESH_MS = 30 * 60_000;
export const CLUSTER_STALE_MS = 4 * CLUSTER_REFRESH_MS;

export type Health = "ok" | "stale" | "down";

type When = Date | string | null;

function health(lastOk: When, error: string | null, staleMs: number, now: number): Health {
  if (error) return "down";
  if (!lastOk || now - new Date(lastOk).getTime() > staleMs) return "stale";
  return "ok";
}

export function agentHealth(
  agent: { lastValidatedAt: When; lastError: string | null },
  now = Date.now(),
): Health {
  return health(agent.lastValidatedAt, agent.lastError, AGENT_STALE_MS, now);
}

/** The cluster API as Drill sees it (the kubeconfig); its agent is reported apart. */
export function clusterHealth(
  cluster: { lastDiscoveredAt: When; discoveryError: string | null },
  now = Date.now(),
): Health {
  return health(cluster.lastDiscoveredAt, cluster.discoveryError, CLUSTER_STALE_MS, now);
}

export const HEALTH_DOT: Record<Health, string> = {
  ok: "bg-traffic-green",
  stale: "bg-bone-gray",
  down: "bg-traffic-red",
};

export const HEALTH_TEXT: Record<Health, string> = {
  ok: "text-traffic-green",
  stale: "text-bone-gray",
  down: "text-traffic-red",
};

export interface ClusterStatus {
  health: Health;
  summary: string;
  /** The underlying error or hint, for a tooltip or banner. */
  detail: string | null;
}

/**
 * A cluster is only as healthy as the worse of its two connections: the API
 * Drill reads inventory through, and the agent that investigates it.
 */
export function clusterStatus(
  c: {
    lastDiscoveredAt: When;
    discoveryError: string | null;
    agentName: string;
    agentLastValidatedAt: When;
    agentLastError: string | null;
  },
  now = Date.now(),
): ClusterStatus {
  const api = clusterHealth(c, now);
  const agent = agentHealth({ lastValidatedAt: c.agentLastValidatedAt, lastError: c.agentLastError }, now);
  if (api === "down") {
    return { health: "down", summary: "Cluster API unreachable", detail: c.discoveryError };
  }
  if (agent === "down") {
    return { health: "down", summary: `Agent ${c.agentName} unreachable`, detail: c.agentLastError };
  }
  if (api === "stale" || agent === "stale") {
    return {
      health: "stale",
      summary: "Not checked recently",
      detail: "No successful check in a while — is the Drill worker running?",
    };
  }
  return { health: "ok", summary: "Connected", detail: null };
}
