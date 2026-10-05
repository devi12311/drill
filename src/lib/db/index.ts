import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? "postgres://drill:drill@localhost:5433/drill";

// One pool per process. Dev hot reload re-evaluates this module on every edit,
// and a fresh `postgres()` each time never closes the last: a long dev session
// leaked its way to Postgres's 100-connection limit ("too many clients").
const pg = globalThis as { __drillPg?: ReturnType<typeof postgres> };
const client = (pg.__drillPg ??= postgres(connectionString, { max: 5 }));

export const db = drizzle(client, { schema });

/** `db` itself or an open transaction — for writes that must join a caller's transaction. */
export type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * A unique-constraint violation (Postgres 23505). Drizzle wraps driver errors in
 * a DrizzleQueryError with the Postgres error as `cause`, so the code is never on
 * the error itself.
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

/**
 * Postgres LISTEN on a dedicated connection (postgres.js reconnects it and
 * re-subscribes by itself). A wake-up signal only — never the source of truth:
 * a notification sent while nobody listened is simply lost, so every listener
 * also polls.
 */
export async function listen(
  channel: string,
  onNotify: () => void,
): Promise<void> {
  await client.listen(channel, onNotify);
}

export async function notify(channel: string): Promise<void> {
  await client.notify(channel, "");
}
