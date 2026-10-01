import "server-only";
import { claimQueuedRuns, unmuteExpired } from "@/lib/db/monitoring-queries";
import { executeClaimedRun, reapStaleRuns } from "./runner";

/**
 * The monitoring worker: the only process that executes runs.
 *
 * Same image and same code as the web server, started from `instrumentation.ts`
 * and selected by `DRILL_ROLE`. It exists so no HTTP request ever waits on an
 * investigation: a deep run is hours of held Holmes streams, and executing it in
 * the web process meant every deploy of the UI silently killed runs already paid
 * for. The browser and the scheduler only ever write `queued` rows and read
 * Postgres; this loop is what turns a queued row into concerns.
 *
 * One run at a time per worker — concurrent agentic investigations hit LLM rate
 * limits (Holmes surfaces those as SSE error_code 5204). More throughput means
 * more replicas, which `FOR UPDATE SKIP LOCKED` already makes safe.
 */

export type DrillRole = "web" | "worker" | "all";

/**
 * `all` is the default so local dev and a single-pod deploy keep working with no
 * configuration: that one process serves the UI AND runs the loop.
 */
export function drillRole(): DrillRole {
  const role = process.env.DRILL_ROLE;
  return role === "web" || role === "worker" ? role : "all";
}

/** How long an idle worker waits before asking the queue again. */
const POLL_MS = 3_000;
/** Reaping dead runs and expiring mutes; neither is urgent to the second. */
const HOUSEKEEPING_MS = 60_000;
/**
 * How long a SIGTERM waits for the active run to abort its Holmes call and commit
 * what finished. Must stay under the pod's `terminationGracePeriodSeconds`.
 */
const SHUTDOWN_BUDGET_MS = 45_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function startWorker(): void {
  // `register()` runs once per server, but dev re-evaluates modules on reload; a
  // second loop would claim runs alongside the first.
  const flag = globalThis as { __drillWorkerStarted?: boolean };
  if (flag.__drillWorkerStarted) return;
  flag.__drillWorkerStarted = true;

  const shutdown = new AbortController();
  let active: Promise<void> | null = null;

  const stop = async () => {
    if (shutdown.signal.aborted) return;
    console.log("[drill worker] shutting down — finalizing the active run");
    shutdown.abort();
    await Promise.race([
      active ?? Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_BUDGET_MS)),
    ]);
    // With NEXT_MANUAL_SIG_HANDLE, Next no longer exits on the signal itself —
    // that is what gives the run time to finalize — so exiting is ours to do.
    // Without it Next's own handler exits, and a run cut short is the reaper's.
    if (process.env.NEXT_MANUAL_SIG_HANDLE) process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  const loop = async () => {
    let lastHousekeeping = 0;
    while (!shutdown.signal.aborted) {
      try {
        if (Date.now() - lastHousekeeping >= HOUSEKEEPING_MS) {
          lastHousekeeping = Date.now();
          await reapStaleRuns();
          await unmuteExpired();
        }
        const [run] = await claimQueuedRuns(1);
        if (run) {
          active = executeClaimedRun(run, shutdown.signal);
          await active;
          active = null;
          continue;
        }
      } catch (err) {
        // A database blip must not end the loop; the next poll tries again.
        console.error("[drill worker]", err);
      }
      await sleep(POLL_MS, shutdown.signal);
    }
  };

  console.log(`[drill worker] started (DRILL_ROLE=${drillRole()})`);
  void loop();
}
