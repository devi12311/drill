import "server-only";
import { chatLane } from "@/lib/chat/lane";
import { monitoringLane } from "@/lib/monitoring/worker";
import { runLane } from "./lane";

/**
 * The worker: the only process that executes investigations — monitoring runs and
 * chat turns, one lane each (./lane.ts).
 *
 * Same image and same code as the web server, started from `instrumentation.ts`
 * and selected by `DRILL_ROLE`. It exists so no HTTP request ever waits on an
 * investigation: executing one in the web process meant every deploy of the UI
 * silently killed investigations already paid for. The browser only ever writes
 * `queued` rows and reads Postgres; the lanes turn those rows into results.
 */

export type DrillRole = "web" | "worker" | "all";

/**
 * `all` is the default so local dev and a single-pod deploy keep working with no
 * configuration: that one process serves the UI AND runs the lanes.
 */
export function drillRole(): DrillRole {
  const role = process.env.DRILL_ROLE;
  return role === "web" || role === "worker" ? role : "all";
}

/**
 * How long a SIGTERM waits for active work to abort its Holmes calls and record
 * where it stopped. Must stay under the pod's `terminationGracePeriodSeconds`.
 */
const SHUTDOWN_BUDGET_MS = 45_000;

export function startWorker(): void {
  // `register()` runs once per server, but dev re-evaluates modules on reload; a
  // second set of lanes would claim work alongside the first.
  const flag = globalThis as { __drillWorkerStarted?: boolean };
  if (flag.__drillWorkerStarted) return;
  flag.__drillWorkerStarted = true;

  const shutdown = new AbortController();
  const lanes = [
    runLane(monitoringLane, shutdown.signal),
    runLane(chatLane, shutdown.signal),
  ];

  const stop = async () => {
    if (shutdown.signal.aborted) return;
    console.log("[drill worker] shutting down — settling active work");
    shutdown.abort();
    await Promise.race([
      Promise.all(lanes.map((lane) => lane.drain())),
      new Promise((resolve) => setTimeout(resolve, SHUTDOWN_BUDGET_MS)),
    ]);
    // With NEXT_MANUAL_SIG_HANDLE, Next no longer exits on the signal itself —
    // that is what gives the work time to settle — so exiting is ours to do.
    // Without it Next's own handler exits, and what was cut short is the reaper's.
    if (process.env.NEXT_MANUAL_SIG_HANDLE) process.exit(0);
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  console.log(
    `[drill worker] started (DRILL_ROLE=${drillRole()}, chat lane ×${chatLane.concurrency})`,
  );
}
