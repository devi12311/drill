import "server-only";
import { and, eq, notLike, or } from "drizzle-orm";
import { db } from "./index";
import { holmesAgents, monitoringClusters } from "./schema";
import { encryptionEnabled, sealSecret } from "@/lib/secrets";

/**
 * Seal every credential still stored in plaintext — rows written before
 * encryption existed, or while a dev install ran without a key. Run at start-up.
 *
 * Each update is conditional on the value still being the plaintext it read, so
 * the web and worker processes starting together cannot double-seal a row or
 * overwrite a credential someone changed meanwhile.
 */
export async function sealLegacySecrets(): Promise<number> {
  if (!encryptionEnabled()) return 0;
  let sealed = 0;

  const agents = await db
    .select({ id: holmesAgents.id, apiKey: holmesAgents.apiKey })
    .from(holmesAgents)
    .where(notLike(holmesAgents.apiKey, "enc:v1:%"));
  for (const a of agents) {
    const rows = await db
      .update(holmesAgents)
      .set({ apiKey: sealSecret(a.apiKey) })
      .where(and(eq(holmesAgents.id, a.id), eq(holmesAgents.apiKey, a.apiKey)))
      .returning({ id: holmesAgents.id });
    sealed += rows.length;
  }

  const clusters = await db
    .select({
      id: monitoringClusters.id,
      kubeconfig: monitoringClusters.kubeconfig,
      holmesApiKey: monitoringClusters.holmesApiKey,
    })
    .from(monitoringClusters)
    .where(
      or(
        notLike(monitoringClusters.kubeconfig, "enc:v1:%"),
        notLike(monitoringClusters.holmesApiKey, "enc:v1:%"),
      ),
    );
  for (const c of clusters) {
    const rows = await db
      .update(monitoringClusters)
      .set({
        kubeconfig: sealSecret(c.kubeconfig),
        holmesApiKey: sealSecret(c.holmesApiKey),
      })
      .where(
        and(
          eq(monitoringClusters.id, c.id),
          eq(monitoringClusters.kubeconfig, c.kubeconfig),
          eq(monitoringClusters.holmesApiKey, c.holmesApiKey),
        ),
      )
      .returning({ id: monitoringClusters.id });
    sealed += rows.length;
  }
  return sealed;
}
