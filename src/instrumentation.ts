/**
 * Server start-up hook (Next's `register`). Checks credential encryption is
 * configured and seals any plaintext credentials, then starts the monitoring
 * worker unless this process is web-only — see `drillRole` in lib/worker.
 *
 * Not awaited: `register` must finish before the server takes requests, and the
 * worker's loop never finishes.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` evaluates server code too; a build must never claim a run.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  // Credentials at rest (decision 129): no key in production is a refusal to
  // start, not a warning; then any plaintext left from before is sealed.
  const { assertEncryptionReady } = await import("@/lib/secrets");
  assertEncryptionReady();
  const { sealLegacySecrets } = await import("@/lib/db/secret-backfill");
  await sealLegacySecrets()
    .then((n) => n > 0 && console.log(`[drill] sealed ${n} stored credential row(s)`))
    .catch((err) => console.error("[drill] could not seal stored credentials:", err));
  const { drillRole, startWorker } = await import("@/lib/worker");
  if (drillRole() !== "web") startWorker();
}
