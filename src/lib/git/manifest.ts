import "server-only";
import { manifestFor, orgsWithGit } from "@/lib/db/git-queries";
import { gateway, gitModuleEnabled, type GatewayManifest } from "./gateway";
import { isBranchName, isRepoName } from "./types";

/**
 * Tell the gateway what an org's repositories and agents are now. Built from the
 * database at the moment of sending, so the latest push always carries the latest
 * state; pushes for one org are chained within a process so an older snapshot
 * cannot land after a newer one. (Across web and worker processes two pushes can
 * still interleave; the worker's periodic reconcile converges them within minutes.)
 */
const chains = new Map<string, Promise<unknown>>();

export function pushManifest(orgId: string): Promise<void> {
  if (!gitModuleEnabled()) return Promise.resolve();
  const run = async () => {
    const { agents, repos, branches } = await manifestFor(orgId);
    const manifest: GatewayManifest = {
      agents,
      // The gateway rejects a manifest with any invalid entry, and a rejected push
      // also stops REVOCATIONS (a removed repo, a deleted agent) from landing. So an
      // entry the gateway would refuse is left out here, loudly, never sent.
      repos: repos.flatMap((r) => {
        const own = branches.filter((b) => b.repositoryId === r.id && isBranchName(b.name));
        const def = own.find((b) => b.name === r.defaultBranch);
        if (!def || !isRepoName(r.name)) {
          console.error(`[drill git] repository ${r.id} (${r.name}) left out of the gateway manifest: invalid name or default branch`);
          return [];
        }
        return [{ id: r.id, name: r.name, cloneUrl: r.cloneUrl, defaultBranchId: def.id, branches: own.map(({ id, name }) => ({ id, name })) }];
      }),
    };
    await gateway.putManifest(orgId, manifest);
  };
  const next = (chains.get(orgId) ?? Promise.resolve()).then(run, run);
  const tail = next.catch(() => undefined);
  chains.set(orgId, tail);
  void tail.then(() => {
    if (chains.get(orgId) === tail) chains.delete(orgId);
  });
  return next;
}

/**
 * Best-effort push after a change made in a request (a repo removed, an agent
 * added). A failure must not fail the request — the reconcile below repairs it —
 * but it is logged, because until then the gateway serves the previous state.
 */
export function pushManifestSoon(orgId: string): void {
  pushManifest(orgId).catch((err) => console.error(`[drill git] manifest push for org ${orgId} failed`, err));
}

/** Worker housekeeping: every org's manifest, and drop gateway data of orgs that no longer exist. */
export async function reconcileGateway(): Promise<void> {
  if (!gitModuleEnabled()) return;
  // One org's failure must not stop the rest from converging.
  for (const orgId of await orgsWithGit()) {
    await pushManifest(orgId).catch((err) => console.error(`[drill git] reconcile of org ${orgId} failed`, err));
  }
  // Re-read just before retaining, so an org created during the pushes above is in
  // the list (the gateway also keeps any org pushed in the last minutes).
  const orgs = await orgsWithGit();
  if (orgs.length) await gateway.retainOrgs(orgs);
}
