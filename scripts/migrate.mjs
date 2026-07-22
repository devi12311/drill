// Standalone migration runner for containerized deploys.
//
// Applies the generated SQL in ./drizzle using drizzle-orm's postgres-js
// migrator. Deliberately uses ONLY runtime deps (drizzle-orm + postgres, both
// already in "dependencies") so it works inside the Next.js standalone image
// without needing drizzle-kit. Run as an initContainer before the app starts:
//   node scripts/migrate.mjs
//
// Behaviour:
//  - retries the initial connection (~60s) so it tolerates Postgres still
//    coming up during a fresh `helm install`;
//  - takes a Postgres advisory lock so concurrent pods (replicas > 1, rollouts)
//    serialize instead of racing on the migrations table;
//  - migration 0001 runs CREATE EXTENSION vector / pg_trgm, so the target must
//    be a pgvector-capable Postgres with sufficient privileges.

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://drill:drill@localhost:5433/drill";

// A stable, arbitrary key so every Drill pod contends for the same lock.
const LOCK_KEY = 4919283746n;

const MAX_ATTEMPTS = 30;
const RETRY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForPostgres() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const probe = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      await probe`select 1`;
      await probe.end({ timeout: 5 });
      return;
    } catch (err) {
      await probe.end({ timeout: 5 }).catch(() => {});
      if (attempt === MAX_ATTEMPTS) throw err;
      console.log(
        `[migrate] Postgres not ready (attempt ${attempt}/${MAX_ATTEMPTS}): ${err.message}`,
      );
      await sleep(RETRY_MS);
    }
  }
}

async function main() {
  console.log("[migrate] waiting for Postgres…");
  await waitForPostgres();

  // Dedicated connection; `max: 1` keeps the advisory lock on one backend.
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
  const db = drizzle(sql);

  try {
    console.log("[migrate] acquiring advisory lock…");
    await sql`select pg_advisory_lock(${LOCK_KEY})`;

    console.log("[migrate] applying migrations from ./drizzle …");
    await migrate(db, { migrationsFolder: "./drizzle" });

    console.log("[migrate] done.");
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[migrate] FAILED:", err);
  process.exit(1);
});
