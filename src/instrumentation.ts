/**
 * Server start-up hook (Next's `register`). Starts the monitoring worker unless
 * this process is web-only — see `drillRole` in lib/monitoring/worker.ts.
 *
 * Not awaited: `register` must finish before the server takes requests, and the
 * worker's loop never finishes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` evaluates server code too; a build must never claim a run.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { drillRole, startWorker } = await import("@/lib/monitoring/worker");
  if (drillRole() !== "web") startWorker();
}
