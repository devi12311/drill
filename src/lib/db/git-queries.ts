import "server-only";
import { and, asc, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import { db, notify } from "./index";
import { gitConnections, gitRepoBranches, gitRepositories, holmesAgents } from "./schema";
import { openSecret, sealSecret } from "@/lib/secrets";
import { isUuid } from "@/lib/uuid";
import type { Scope } from "./queries";
import {
  ACTIVE_SYNC_STATES,
  type BranchSyncState,
  type GitProvider,
  type IndexStats,
} from "@/lib/git/types";

/**
 * Every read and write here is org-scoped in its WHERE clause: a foreign id finds
 * nothing, exactly like a missing one, so routes answer both with the same 404.
 */

export const GIT_SYNC_CHANNEL = "drill_git_sync";

const ERROR_LIMIT = 2_000;
const clip = (s: string) => (s.length > ERROR_LIMIT ? `${s.slice(0, ERROR_LIMIT)}…` : s);

// ---- Connections ----

/** Everything but the token — what lists and pages render. */
const connectionColumns = {
  id: gitConnections.id,
  provider: gitConnections.provider,
  name: gitConnections.name,
  account: gitConnections.account,
  username: gitConnections.username,
  lastValidatedAt: gitConnections.lastValidatedAt,
  lastError: gitConnections.lastError,
  createdAt: gitConnections.createdAt,
};

export async function listConnections(orgId: string) {
  return db
    .select({
      ...connectionColumns,
      repoCount: sql<number>`(select count(*)::int from ${gitRepositories} r where r.connection_id = ${gitConnections.id})`,
    })
    .from(gitConnections)
    .where(eq(gitConnections.orgId, orgId))
    .orderBy(asc(gitConnections.createdAt));
}
export type ConnectionRow = Awaited<ReturnType<typeof listConnections>>[number];

export async function getConnectionSummary(orgId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select(connectionColumns)
    .from(gitConnections)
    .where(and(eq(gitConnections.id, id), eq(gitConnections.orgId, orgId)));
  return row ?? null;
}

/** With the token OPENED — server-side only, the one read path for the credential. */
export async function getConnectionSecrets(orgId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .select()
    .from(gitConnections)
    .where(and(eq(gitConnections.id, id), eq(gitConnections.orgId, orgId)));
  return row ? { ...row, token: openSecret(row.token) } : null;
}

export async function createConnection(
  scope: Scope,
  data: { provider: GitProvider; name: string; account: string; username: string | null; token: string },
) {
  const [row] = await db
    .insert(gitConnections)
    .values({
      ...data,
      token: sealSecret(data.token),
      orgId: scope.orgId,
      createdBy: scope.userId,
      // Callers validate against the provider before saving.
      lastValidatedAt: new Date(),
    })
    .returning(connectionColumns);
  return row;
}

export async function updateConnection(
  orgId: string,
  id: string,
  data: { name: string; account: string; username: string | null; token: string },
) {
  const [row] = await db
    .update(gitConnections)
    .set({
      ...data,
      token: sealSecret(data.token),
      lastValidatedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(and(eq(gitConnections.id, id), eq(gitConnections.orgId, orgId)))
    .returning(connectionColumns);
  return row ?? null;
}

/** Refused while repositories still sync through it — they would lose their credentials. */
export async function deleteConnection(orgId: string, id: string): Promise<"deleted" | "in-use" | "missing"> {
  if (!isUuid(id)) return "missing";
  const [inUse] = await db
    .select({ id: gitRepositories.id })
    .from(gitRepositories)
    .where(and(eq(gitRepositories.connectionId, id), eq(gitRepositories.orgId, orgId)))
    .limit(1);
  if (inUse) return "in-use";
  const deleted = await db
    .delete(gitConnections)
    .where(and(eq(gitConnections.id, id), eq(gitConnections.orgId, orgId)))
    .returning({ id: gitConnections.id });
  return deleted.length ? "deleted" : "missing";
}

/**
 * Every connection of every org, token opened — for the worker's health probe only.
 * Each row opens on its own: one undecryptable token is that connection's error,
 * not a probe failure for every org.
 */
export async function listConnectionsToProbe() {
  const rows = await db.select().from(gitConnections);
  return rows.map((r) => {
    try {
      return { ...r, token: openSecret(r.token), openError: null };
    } catch (err) {
      return { ...r, token: "", openError: err instanceof Error ? err.message : String(err) };
    }
  });
}

export async function recordConnectionContact(id: string, error: string | null) {
  await db
    .update(gitConnections)
    .set(error ? { lastError: clip(error) } : { lastValidatedAt: new Date(), lastError: null })
    .where(eq(gitConnections.id, id));
}

// ---- Repositories & branches ----

const branchColumns = {
  id: gitRepoBranches.id,
  repositoryId: gitRepoBranches.repositoryId,
  name: gitRepoBranches.name,
  state: gitRepoBranches.state,
  lastSha: gitRepoBranches.lastSha,
  lastSyncedAt: gitRepoBranches.lastSyncedAt,
  error: gitRepoBranches.error,
  stats: gitRepoBranches.stats,
  queuedAt: gitRepoBranches.queuedAt,
};
export type BranchRow = {
  id: string;
  repositoryId: string;
  name: string;
  state: BranchSyncState;
  lastSha: string | null;
  lastSyncedAt: Date | null;
  error: string | null;
  stats: IndexStats | null;
  queuedAt: Date;
};

const repoColumns = {
  id: gitRepositories.id,
  connectionId: gitRepositories.connectionId,
  externalId: gitRepositories.externalId,
  fullName: gitRepositories.fullName,
  name: gitRepositories.name,
  defaultBranch: gitRepositories.defaultBranch,
  createdAt: gitRepositories.createdAt,
};

/** The org's repositories with their branches — the tree, the overview and the manifest all read this. */
export async function listRepositories(orgId: string, connectionId?: string) {
  // A malformed id would be a Postgres uuid-cast error (a 500), not "nothing".
  if (connectionId !== undefined && !isUuid(connectionId)) return [];
  const repos = await db
    .select(repoColumns)
    .from(gitRepositories)
    .where(
      and(
        eq(gitRepositories.orgId, orgId),
        connectionId ? eq(gitRepositories.connectionId, connectionId) : undefined,
      ),
    )
    .orderBy(asc(gitRepositories.name));
  if (!repos.length) return [];
  const branches = await db
    .select(branchColumns)
    .from(gitRepoBranches)
    .where(inArray(gitRepoBranches.repositoryId, repos.map((r) => r.id)))
    .orderBy(asc(gitRepoBranches.createdAt));
  return repos.map((r) => ({
    ...r,
    branches: branches.filter((b) => b.repositoryId === r.id) as BranchRow[],
  }));
}
export type RepositoryWithBranches = Awaited<ReturnType<typeof listRepositories>>[number];

export async function getRepository(orgId: string, id: string): Promise<(RepositoryWithBranches & { cloneUrl: string }) | null> {
  if (!isUuid(id)) return null;
  const [repo] = await db
    .select({ ...repoColumns, cloneUrl: gitRepositories.cloneUrl })
    .from(gitRepositories)
    .where(and(eq(gitRepositories.id, id), eq(gitRepositories.orgId, orgId)));
  if (!repo) return null;
  const branches = (await db
    .select(branchColumns)
    .from(gitRepoBranches)
    .where(eq(gitRepoBranches.repositoryId, id))
    .orderBy(asc(gitRepoBranches.createdAt))) as BranchRow[];
  return { ...repo, branches };
}

export interface NewRepository {
  externalId: string;
  fullName: string;
  name: string;
  cloneUrl: string;
  defaultBranch: string;
}

/**
 * Add repositories to a connection, each with its default branch queued. The
 * agent-facing name is the slug; when another repo of the org already has it, the
 * full `owner/slug` is used instead. A repo already on this connection is skipped.
 */
export async function addRepositories(
  scope: Scope,
  connectionId: string,
  repos: NewRepository[],
): Promise<{ added: { id: string; name: string }[]; skipped: { fullName: string; reason: string }[] }> {
  const added: { id: string; name: string }[] = [];
  const skipped: { fullName: string; reason: string }[] = [];
  await db.transaction(async (tx) => {
    const taken = new Set(
      (await tx.select({ name: gitRepositories.name }).from(gitRepositories).where(eq(gitRepositories.orgId, scope.orgId))).map(
        (r) => r.name.toLowerCase(),
      ),
    );
    for (const r of repos) {
      const name = [r.name, r.fullName].find((n) => !taken.has(n.toLowerCase()));
      if (!name) {
        skipped.push({ fullName: r.fullName, reason: "a repository with this name is already synced" });
        continue;
      }
      const [row] = await tx
        .insert(gitRepositories)
        .values({ ...r, name, orgId: scope.orgId, connectionId, createdBy: scope.userId })
        .onConflictDoNothing({ target: [gitRepositories.connectionId, gitRepositories.externalId] })
        .returning({ id: gitRepositories.id, name: gitRepositories.name });
      if (!row) {
        skipped.push({ fullName: r.fullName, reason: "already added" });
        continue;
      }
      taken.add(name.toLowerCase());
      await tx.insert(gitRepoBranches).values({ repositoryId: row.id, name: r.defaultBranch });
      added.push(row);
    }
  });
  if (added.length) await notify(GIT_SYNC_CHANNEL).catch(() => null);
  return { added, skipped };
}

/** Rename the agent-facing name. Throws a unique violation when the org already uses it. */
export async function renameRepository(orgId: string, id: string, name: string) {
  const [row] = await db
    .update(gitRepositories)
    .set({ name })
    .where(and(eq(gitRepositories.id, id), eq(gitRepositories.orgId, orgId)))
    .returning({ id: gitRepositories.id });
  return !!row;
}

export async function deleteRepository(orgId: string, id: string) {
  if (!isUuid(id)) return null;
  const [row] = await db
    .delete(gitRepositories)
    .where(and(eq(gitRepositories.id, id), eq(gitRepositories.orgId, orgId)))
    .returning({ id: gitRepositories.id, name: gitRepositories.name });
  return row ?? null;
}

/** Track more branches of a repo; each is queued for its first sync. Returns the names added. */
export async function addBranches(repositoryId: string, names: string[]): Promise<string[]> {
  if (!names.length) return [];
  const rows = await db
    .insert(gitRepoBranches)
    .values(names.map((name) => ({ repositoryId, name })))
    .onConflictDoNothing()
    .returning({ name: gitRepoBranches.name });
  if (rows.length) await notify(GIT_SYNC_CHANNEL).catch(() => null);
  return rows.map((r) => r.name);
}

/** Stop tracking branches. The default branch is never removable — the agent's fallback. */
export async function removeBranches(repositoryId: string, defaultBranch: string, ids: string[]): Promise<number> {
  const valid = ids.filter(isUuid);
  if (!valid.length) return 0;
  const rows = await db
    .delete(gitRepoBranches)
    .where(
      and(
        eq(gitRepoBranches.repositoryId, repositoryId),
        inArray(gitRepoBranches.id, valid),
        sql`${gitRepoBranches.name} <> ${defaultBranch}`,
      ),
    )
    .returning({ id: gitRepoBranches.id });
  return rows.length;
}

/**
 * Queue a sync for every branch in the selection that isn't already queued or
 * syncing (a second click is a no-op, not a second job). The selection is always
 * intersected with the org.
 */
export async function queueSync(
  orgId: string,
  target: { connectionId: string } | { repositoryId: string; branchId?: string },
): Promise<number> {
  const repoFilter =
    "connectionId" in target
      ? eq(gitRepositories.connectionId, target.connectionId)
      : eq(gitRepositories.id, target.repositoryId);
  const repoIds = db
    .select({ id: gitRepositories.id })
    .from(gitRepositories)
    .where(and(eq(gitRepositories.orgId, orgId), repoFilter));
  const rows = await db
    .update(gitRepoBranches)
    .set({ state: "queued", queuedAt: new Date(), error: null })
    .where(
      and(
        inArray(gitRepoBranches.repositoryId, repoIds),
        "branchId" in target && target.branchId ? eq(gitRepoBranches.id, target.branchId) : undefined,
        notInArray(gitRepoBranches.state, [...ACTIVE_SYNC_STATES]),
      ),
    )
    .returning({ id: gitRepoBranches.id });
  if (rows.length) await notify(GIT_SYNC_CHANNEL).catch(() => null);
  return rows.length;
}

// ---- Gateway manifest ----

/** What the gateway must hold for an org: its agents (for scope checks) and every tracked branch. */
export async function manifestFor(orgId: string) {
  const [agents, repos] = await Promise.all([
    db.select({ id: holmesAgents.id }).from(holmesAgents).where(eq(holmesAgents.orgId, orgId)),
    db
      .select({ ...repoColumns, cloneUrl: gitRepositories.cloneUrl })
      .from(gitRepositories)
      .where(eq(gitRepositories.orgId, orgId)),
  ]);
  const branches = repos.length
    ? await db
        .select({ id: gitRepoBranches.id, repositoryId: gitRepoBranches.repositoryId, name: gitRepoBranches.name })
        .from(gitRepoBranches)
        .where(inArray(gitRepoBranches.repositoryId, repos.map((r) => r.id)))
    : [];
  return { agents: agents.map((a) => a.id), repos, branches };
}

/** Orgs that use the module at all — the periodic reconcile pushes each one's manifest. */
export async function orgsWithGit(): Promise<string[]> {
  const rows = await db.selectDistinct({ orgId: gitConnections.orgId }).from(gitConnections);
  return rows.map((r) => r.orgId);
}

// ---- Worker side ----

export interface ClaimedBranch {
  id: string;
  name: string;
  repositoryId: string;
}

export async function claimQueuedBranches(limit: number): Promise<ClaimedBranch[]> {
  const rows = (await db.execute(sql`
    with picked as (
      select id from ${gitRepoBranches}
      where state = 'queued'
      order by queued_at
      limit ${limit}
      for update skip locked
    )
    update ${gitRepoBranches} b set state = 'syncing', job_id = null, heartbeat_at = now()
    from picked where b.id = picked.id
    returning b.id, b.name, b.repository_id
  `)) as unknown as { id: string; name: string; repository_id: string }[];
  return rows.map((r) => ({ id: r.id, name: r.name, repositoryId: r.repository_id }));
}

/** Everything one sync needs, token opened. Null when the branch was removed meanwhile. */
export async function getSyncTarget(branchId: string) {
  const [row] = await db
    .select({
      branchId: gitRepoBranches.id,
      branchName: gitRepoBranches.name,
      jobId: gitRepoBranches.jobId,
      repositoryId: gitRepositories.id,
      orgId: gitRepositories.orgId,
      provider: gitConnections.provider,
      account: gitConnections.account,
      username: gitConnections.username,
      token: gitConnections.token,
    })
    .from(gitRepoBranches)
    .innerJoin(gitRepositories, eq(gitRepositories.id, gitRepoBranches.repositoryId))
    .innerJoin(gitConnections, eq(gitConnections.id, gitRepositories.connectionId))
    .where(eq(gitRepoBranches.id, branchId));
  return row ? { ...row, token: openSecret(row.token) } : null;
}

export async function markBranchJob(branchId: string, jobId: string) {
  await db.update(gitRepoBranches).set({ jobId, heartbeatAt: new Date() }).where(eq(gitRepoBranches.id, branchId));
}

export async function heartbeatBranch(branchId: string) {
  await db.update(gitRepoBranches).set({ heartbeatAt: new Date() }).where(eq(gitRepoBranches.id, branchId));
}

export async function finishBranch(
  branchId: string,
  /** The gateway job this poller followed; null when the sync failed before starting one. */
  jobId: string | null,
  result: { ok: true; sha: string; syncedAt: Date; stats: IndexStats | null } | { ok: false; error: string },
) {
  await db
    .update(gitRepoBranches)
    .set(
      result.ok
        ? { state: "ok", lastSha: result.sha, lastSyncedAt: result.syncedAt, stats: result.stats, error: null, heartbeatAt: null }
        : { state: "error", error: clip(result.error), heartbeatAt: null },
    )
    // Only the sync still in flight — this poller's job — may settle the row; a
    // poller outliving a requeue must not overwrite the newer attempt.
    .where(
      and(
        eq(gitRepoBranches.id, branchId),
        eq(gitRepoBranches.state, "syncing"),
        jobId ? eq(gitRepoBranches.jobId, jobId) : isNull(gitRepoBranches.jobId),
      ),
    );
}

/**
 * Syncs whose worker stopped polling (crash, deploy) go back to the queue. The
 * gateway de-duplicates: re-starting a branch it is still syncing returns the job
 * already running, so the next claim simply re-attaches to it.
 */
export async function requeueStaleSyncs(staleMs: number): Promise<number> {
  const rows = await db
    .update(gitRepoBranches)
    .set({ state: "queued", queuedAt: new Date() })
    .where(and(eq(gitRepoBranches.state, "syncing"), lt(gitRepoBranches.heartbeatAt, new Date(Date.now() - staleMs))))
    .returning({ id: gitRepoBranches.id });
  return rows.length;
}
