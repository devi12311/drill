import "server-only";
import { listAgentsToProbe, recordAgentContact } from "@/lib/db/queries";
import { listClustersToRefresh } from "@/lib/db/monitoring-queries";
import { validateAgent } from "@/lib/holmes/validate";
import { AGENT_PROBE_MS, CLUSTER_REFRESH_MS } from "@/lib/health";
import { refreshInventory } from "@/lib/monitoring/inventory";

/** First pass shortly after boot, so a restarted worker repaints statuses quickly. */
const FIRST_PASS_MS = 15_000;
/** Each target has its own timeout (5s agent, 15s cluster); this bounds a pass. */
const PARALLEL = 4;

async function eachLimited<T>(items: T[], work: (item: T) => Promise<unknown>) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane));
}

async function probeAgents() {
  await eachLimited(await listAgentsToProbe(), async (agent) => {
    try {
      await validateAgent(agent.url, agent.apiKey);
      await recordAgentContact(agent.id, null);
    } catch (err) {
      await recordAgentContact(agent.id, err instanceof Error ? err.message : String(err));
    }
  });
}

async function refreshClusters() {
  // refreshInventory records its own failure on the row.
  await eachLimited(await listClustersToRefresh(), (c) => refreshInventory(c.id, c.orgId));
}

/**
 * The periodic checks behind agent and cluster health (lib/health.ts). They live
 * in the worker, beside the lanes, because the web process may run several
 * replicas or none. Several WORKER replicas each check everything — harmless
 * (the probe is free and a rescan is idempotent), just redundant.
 */
export function startHealthChecks(shutdown: AbortSignal): void {
  const every = (name: string, intervalMs: number, task: () => Promise<void>) => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (shutdown.aborted) return;
      try {
        await task();
      } catch (err) {
        // A database blip must not stop the schedule; the next pass tries again.
        console.error(`[drill worker:health] ${name}`, err);
      }
      if (!shutdown.aborted) timer = setTimeout(tick, intervalMs);
    };
    timer = setTimeout(tick, FIRST_PASS_MS);
    shutdown.addEventListener("abort", () => clearTimeout(timer), { once: true });
  };
  every("agent probe", AGENT_PROBE_MS, probeAgents);
  every("inventory refresh", CLUSTER_REFRESH_MS, refreshClusters);
}
