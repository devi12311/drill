import "server-only";
import { listen } from "@/lib/db";
import {
  claimQueuedBranches,
  finishBranch,
  getSyncTarget,
  GIT_SYNC_CHANNEL,
  heartbeatBranch,
  markBranchJob,
  requeueStaleSyncs,
  type ClaimedBranch,
} from "@/lib/db/git-queries";
import type { Lane } from "@/lib/worker/lane";
import { gateway, gitModuleEnabled } from "./gateway";
import { pushManifest, reconcileGateway } from "./manifest";
import { PROVIDERS } from "./providers";

const POLL_MS = 2_000;
/** Consecutive status polls that may fail (gateway blip) before the sync is given up on. */
const POLL_FAILURES_TOLERATED = 5;
/** A sync whose poller has been silent this long belongs to a dead worker. */
const STALE_MS = 2 * 60_000;
/** Manifest reconcile cadence — repairs failed best-effort pushes and agent changes. */
const RECONCILE_MS = 5 * 60_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), resolve()), { once: true });
  });

/**
 * Hand one branch to the gateway and follow it to its outcome. There is no overall
 * deadline: a first index of a large repository legitimately takes minutes, and
 * the gateway bounds its own git and indexing steps. On shutdown the row is left
 * `syncing`; once its heartbeat goes stale the next worker re-queues it, and the
 * gateway hands back the job it is still running.
 */
async function executeSync(item: ClaimedBranch, shutdown: AbortSignal): Promise<void> {
  let jobId: string | null = null;
  try {
    // Inside the try: an undecryptable token or a DB error must settle the row as
    // an error, not leave it `syncing` to be re-queued forever.
    const target = await getSyncTarget(item.id);
    if (!target) return; // removed while queued
    // The gateway only syncs what its manifest lists, and a branch added a moment
    // ago may not be in it yet.
    await pushManifest(target.orgId);
    const auth = PROVIDERS[target.provider].cloneAuth(target);
    ({ jobId } = await gateway.startSync(target.orgId, target.repositoryId, target.branchId, auth));
    await markBranchJob(item.id, jobId);

    let failures = 0;
    while (!shutdown.aborted) {
      await sleep(POLL_MS, shutdown);
      if (shutdown.aborted) return;
      let branches;
      try {
        ({ branches } = await gateway.repoStatus(target.orgId, target.repositoryId));
        failures = 0;
      } catch (err) {
        // A long first index must not be abandoned over one timeout.
        if (++failures > POLL_FAILURES_TOLERATED) throw err;
        await heartbeatBranch(item.id);
        continue;
      }
      const status = branches[target.branchId];
      if (status && status.jobId === jobId && status.state !== "syncing") {
        await finishBranch(
          item.id,
          jobId,
          status.state === "ok" && status.sha
            ? { ok: true, sha: status.sha, syncedAt: new Date(status.indexedAt ?? Date.now()), stats: status.stats ?? null }
            : { ok: false, error: status.error ?? "sync failed" },
        );
        return;
      }
      if (!status || (status.jobId !== jobId && status.state !== "syncing")) {
        // Lost on the gateway (restart wiped its in-flight job, or the branch was pruned).
        await finishBranch(item.id, jobId, { ok: false, error: "The gateway lost track of this sync — run it again." });
        return;
      }
      await heartbeatBranch(item.id);
    }
  } catch (err) {
    await finishBranch(item.id, jobId, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

let lastReconcile = 0;

async function housekeeping(): Promise<void> {
  await requeueStaleSyncs(STALE_MS);
  if (Date.now() - lastReconcile >= RECONCILE_MS) {
    lastReconcile = Date.now();
    await reconcileGateway();
  }
}

/**
 * Branch syncs. Concurrency is a few, not one: most of a sync is waiting on the
 * gateway (which serializes per repository and caps its own parallelism), and one
 * huge first index must not hold every other repository's Sync button hostage.
 */
export const gitSyncLane: Lane<ClaimedBranch> = {
  name: "git",
  concurrency: 4,
  // An admin just pressed Sync: LISTEN wakes the lane at once; this is the fallback.
  pollMs: 5_000,
  housekeepingMs: 30_000,
  // With no gateway configured nothing is ever queued for it to take.
  claim: (limit) => (gitModuleEnabled() ? claimQueuedBranches(limit) : Promise.resolve([])),
  execute: executeSync,
  housekeeping: () => (gitModuleEnabled() ? housekeeping() : Promise.resolve()),
  subscribe: (wake) => listen(GIT_SYNC_CHANNEL, wake),
};
