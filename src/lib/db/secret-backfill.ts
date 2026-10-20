import "server-only";
import { and, eq, getTableColumns, notLike } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "./index";
import { gitConnections, holmesAgents, monitoringClusters } from "./schema";
import { encryptionEnabled, sealSecret } from "@/lib/secrets";

/**
 * Seal one table's credential column wherever it is still plaintext.
 *
 * Each update is conditional on the value still being the plaintext it read, so
 * the web and worker processes starting together cannot double-seal a row or
 * overwrite a credential someone changed meanwhile.
 */
async function sealColumn(table: PgTable, key: string): Promise<number> {
  // `set()` is keyed by the schema's property name (apiKey), not the SQL column
  // name (api_key) — an unknown key is silently dropped, sealing nothing.
  const columns = getTableColumns(table) as Record<string, PgColumn>;
  const id = columns.id;
  const secret = columns[key];
  const rows = (await db
    .select({ id, secret })
    .from(table)
    .where(notLike(secret, "enc:v1:%"))) as { id: string; secret: string }[];
  let sealed = 0;
  for (const r of rows) {
    const updated = await db
      .update(table)
      .set({ [key]: sealSecret(r.secret) })
      .where(and(eq(id, r.id), eq(secret, r.secret)))
      .returning({ id });
    sealed += updated.length;
  }
  return sealed;
}

/**
 * Seal every credential still stored in plaintext — rows written before
 * encryption existed, or while a dev install ran without a key. Run at start-up.
 * A new credential column is one more line here.
 */
export async function sealLegacySecrets(): Promise<number> {
  if (!encryptionEnabled()) return 0;
  const counts = await Promise.all([
    sealColumn(holmesAgents, "apiKey"),
    sealColumn(monitoringClusters, "kubeconfig"),
    sealColumn(gitConnections, "token"),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}
