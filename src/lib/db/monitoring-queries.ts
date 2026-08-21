import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  sql,
} from "drizzle-orm";
import { db } from "./index";
import {
  monitoringChecks,
  monitoringClusters,
  monitoringConcerns,
  monitoringJobCheckOverrides,
  monitoringJobTargets,
  monitoringJobs,
  monitoringObservations,
  monitoringPlaybooks,
  monitoringRunFindings,
  monitoringRuns,
  monitoringWorkloads,
} from "./schema";
import { PROFILED_TECHNOLOGIES } from "@/lib/monitoring/profiles";
import {
  CLUSTER_TECHNOLOGY,
  DISMISSED_STATUSES,
  isClusterTarget,
} from "@/lib/monitoring/types";
import type {
  ExpectedObservations,
  ObservationSpec,
} from "@/lib/monitoring/playbook";
import type {
  AssessmentObservation,
  AssessmentTarget,
  ConcernStatus,
  MonitorCategory,
  MonitorDepth,
  ResolvedTarget,
  RunCoverage,
  RunTrigger,
  Severity,
  TargetKind,
  WorkloadKind,
  WorkloadTechnology,
} from "@/lib/monitoring/types";

/**
 * All monitoring-module data access. Separate from the user-scoped
 * `queries.ts` (which stays pristine) and from `admin-queries.ts` (analytics),
 * following the precedent in docs/DECISIONS.md.
 *
 * Monitoring rows are GLOBAL admin infrastructure — nothing here is scoped by
 * user, and every caller is behind `requireAdmin()`.
 */

// ---- Check catalogue (the live rubric) ----

export interface CheckRow {
  id: string;
  category: MonitorCategory;
  title: string;
  question: string;
  evidence: string;
  reference: string;
  baseSeverity: Severity;
  appliesTo: string[];
  appliesToTechnologies: string[];
  excludesTechnologies: string[];
  requires: string | null;
  resolveAfterAbsentRuns: number;
  builtin: boolean;
  enabled: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function listAllChecks(): Promise<CheckRow[]> {
  return db
    .select()
    .from(monitoringChecks)
    .orderBy(asc(monitoringChecks.category), asc(monitoringChecks.id));
}

export async function getCheckRow(id: string): Promise<CheckRow | null> {
  const [row] = await db
    .select()
    .from(monitoringChecks)
    .where(eq(monitoringChecks.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Seed the built-in rubric. `onConflictDoNothing` is the whole point: an admin
 * who retunes or disables a built-in must never have that edit reverted by the
 * next process start.
 */
export async function seedBuiltinChecks(
  rows: Omit<CheckRow, "createdAt" | "updatedAt" | "version" | "enabled">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(monitoringChecks)
    .values(rows.map((r) => ({ ...r, builtin: true })))
    .onConflictDoNothing()
    .returning({ id: monitoringChecks.id });
  return inserted.length;
}

export async function createCheck(
  input: Omit<CheckRow, "createdAt" | "updatedAt" | "version" | "builtin">,
  createdBy: string,
): Promise<CheckRow> {
  const [row] = await db
    .insert(monitoringChecks)
    .values({ ...input, builtin: false, createdBy })
    .returning();
  return row;
}

export async function updateCheck(
  id: string,
  fields: Partial<Omit<CheckRow, "id" | "builtin" | "createdAt" | "updatedAt">>,
): Promise<CheckRow | null> {
  const [row] = await db
    .update(monitoringChecks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(monitoringChecks.id, id))
    .returning();
  return row ?? null;
}

export async function deleteCheck(id: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringChecks)
    .where(eq(monitoringChecks.id, id))
    .returning({ id: monitoringChecks.id });
  return rows.length > 0;
}

/** Concern history referencing a check — what makes deletion unsafe. */
export async function countConcernsForCheck(checkId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(monitoringConcerns)
    .where(eq(monitoringConcerns.checkId, checkId));
  return row?.n ?? 0;
}

/**
 * Close concerns for a check that has just stopped being evaluated. Without
 * this they would sit open forever: reconciliation deliberately never touches a
 * concern whose check did not run, so nothing else can ever close them.
 * Scoped to one job when the check was disabled per-job rather than globally.
 */
export async function autoResolveConcernsForDisabledCheck(
  checkId: string,
  jobId?: string,
): Promise<number> {
  const rows = await db
    .update(monitoringConcerns)
    .set({
      status: "auto_resolved",
      lastResolvedAt: new Date(),
      dismissalReason: "check_disabled",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(monitoringConcerns.checkId, checkId),
        eq(monitoringConcerns.status, "open"),
        ...(jobId ? [eq(monitoringConcerns.jobId, jobId)] : []),
      ),
    )
    .returning({ id: monitoringConcerns.id });
  return rows.length;
}

// ---- Per-job catalogue overrides ----

// ---- Playbooks (the live methods) ----

export interface PlaybookRow {
  technology: WorkloadTechnology;
  framing: string;
  dataSources: string[];
  method: string[];
  observations: ObservationSpec[];
  editedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listPlaybookRows(): Promise<PlaybookRow[]> {
  return db
    .select()
    .from(monitoringPlaybooks)
    .orderBy(asc(monitoringPlaybooks.technology));
}

export async function getPlaybookRow(
  technology: WorkloadTechnology,
): Promise<PlaybookRow | null> {
  const [row] = await db
    .select()
    .from(monitoringPlaybooks)
    .where(eq(monitoringPlaybooks.technology, technology))
    .limit(1);
  return row ?? null;
}

/**
 * Seed the shipped methods: insert what is missing, and refresh what nobody has
 * edited.
 *
 * Deliberately unlike `seedBuiltinChecks`, which is insert-only. A check has an
 * identity a run's history hangs off, so overwriting one silently rewrites what a
 * past finding meant; a playbook is only instructions for the next run, and the
 * editor offers no "adopt the shipped text" button, so insert-only would strand
 * every installed database on the text it first saw. `edited_by IS NULL` is the
 * whole rule: an operator's edit always wins, a pristine row always tracks git.
 */
export async function seedPlaybooks(
  rows: Omit<PlaybookRow, "editedBy" | "createdAt" | "updatedAt">[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const written = await db
    .insert(monitoringPlaybooks)
    .values(rows)
    .onConflictDoUpdate({
      target: monitoringPlaybooks.technology,
      set: {
        framing: sql`excluded.framing`,
        dataSources: sql`excluded.data_sources`,
        method: sql`excluded.method`,
        observations: sql`excluded.observations`,
        updatedAt: new Date(),
      },
      setWhere: isNull(monitoringPlaybooks.editedBy),
    })
    .returning({ technology: monitoringPlaybooks.technology });
  return written.length;
}

/** Write an edited method. */
export async function updatePlaybook(
  technology: WorkloadTechnology,
  fields: Pick<
    PlaybookRow,
    "framing" | "dataSources" | "method" | "observations"
  > & { editedBy: string | null },
): Promise<PlaybookRow | null> {
  const [row] = await db
    .update(monitoringPlaybooks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(monitoringPlaybooks.technology, technology))
    .returning();
  return row ?? null;
}

/**
 * How many readings each of these observation keys already has — what makes a key
 * un-renameable. Counted per KEY rather than per playbook on purpose: two engines
 * that measure the same thing deliberately share a key (17 do), so the series
 * belongs to the key, not to the method that happens to be asking.
 */
export async function observedKeyCounts(
  keys: readonly string[],
): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  const rows = await db
    .select({ key: monitoringObservations.key, n: count() })
    .from(monitoringObservations)
    .where(inArray(monitoringObservations.key, [...keys]))
    .groupBy(monitoringObservations.key);
  return Object.fromEntries(rows.map((r) => [r.key, r.n]));
}

export interface JobCheckOverride {
  checkId: string;
  enabled: boolean;
  severityOverride: Severity | null;
}

export async function listJobOverrides(
  jobId: string,
): Promise<JobCheckOverride[]> {
  return db
    .select({
      checkId: monitoringJobCheckOverrides.checkId,
      enabled: monitoringJobCheckOverrides.enabled,
      severityOverride: monitoringJobCheckOverrides.severityOverride,
    })
    .from(monitoringJobCheckOverrides)
    .where(eq(monitoringJobCheckOverrides.jobId, jobId));
}

/** Replace a job's overrides wholesale; rows equal to "inherit" are omitted. */
export async function replaceJobOverrides(
  jobId: string,
  overrides: JobCheckOverride[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(monitoringJobCheckOverrides)
      .where(eq(monitoringJobCheckOverrides.jobId, jobId));
    const meaningful = overrides.filter(
      (o) => !o.enabled || o.severityOverride !== null,
    );
    if (meaningful.length > 0) {
      await tx
        .insert(monitoringJobCheckOverrides)
        .values(meaningful.map((o) => ({ jobId, ...o })));
    }
  });
}

// ---- Clusters ----

/** Cluster row without secrets — the only shape that may reach the client. */
export interface ClusterSummary {
  id: string;
  name: string;
  holmesUrl: string;
  lastValidatedAt: Date | null;
  lastDiscoveredAt: Date | null;
  discoveryError: string | null;
  createdAt: Date;
}

const CLUSTER_SAFE_COLUMNS = {
  id: monitoringClusters.id,
  name: monitoringClusters.name,
  holmesUrl: monitoringClusters.holmesUrl,
  lastValidatedAt: monitoringClusters.lastValidatedAt,
  lastDiscoveredAt: monitoringClusters.lastDiscoveredAt,
  discoveryError: monitoringClusters.discoveryError,
  createdAt: monitoringClusters.createdAt,
};

export interface ClusterListRow extends ClusterSummary {
  workloadCount: number;
  jobCount: number;
  openConcerns: number;
}

/**
 * Correlated counts are written as plain, fully-qualified SQL on purpose.
 * Interpolating drizzle column objects into a raw `sql` template emits
 * UNQUALIFIED identifiers (`"id"`), which inside a subquery bind to the inner
 * table — silently comparing the wrong columns, or failing as ambiguous.
 */
export async function listClusters(): Promise<ClusterListRow[]> {
  const rows = await db
    .select({
      ...CLUSTER_SAFE_COLUMNS,
      workloadCount: sql<number>`(select count(*)::int from monitoring_workloads w
        where w.cluster_id = monitoring_clusters.id)`,
      jobCount: sql<number>`(select count(*)::int from monitoring_jobs j
        where j.cluster_id = monitoring_clusters.id)`,
      openConcerns: sql<number>`(select count(*)::int from monitoring_concerns c
        join monitoring_jobs j on j.id = c.job_id
        where j.cluster_id = monitoring_clusters.id and c.status = 'open')`,
    })
    .from(monitoringClusters)
    .orderBy(asc(monitoringClusters.name));
  return rows;
}

export async function getClusterSummary(
  id: string,
): Promise<ClusterSummary | null> {
  const [row] = await db
    .select(CLUSTER_SAFE_COLUMNS)
    .from(monitoringClusters)
    .where(eq(monitoringClusters.id, id))
    .limit(1);
  return row ?? null;
}

/** Full row INCLUDING kubeconfig + Holmes key — server-side use only. */
export async function getClusterSecrets(id: string) {
  const [row] = await db
    .select()
    .from(monitoringClusters)
    .where(eq(monitoringClusters.id, id))
    .limit(1);
  return row ?? null;
}

export async function createCluster(input: {
  name: string;
  kubeconfig: string;
  holmesUrl: string;
  holmesApiKey: string;
  createdBy: string;
}): Promise<ClusterSummary> {
  const [row] = await db
    .insert(monitoringClusters)
    .values({ ...input, lastValidatedAt: new Date() })
    .returning(CLUSTER_SAFE_COLUMNS);
  return row;
}

export async function updateCluster(
  id: string,
  fields: Partial<{
    name: string;
    kubeconfig: string;
    holmesUrl: string;
    holmesApiKey: string;
    lastValidatedAt: Date;
  }>,
): Promise<ClusterSummary | null> {
  const [row] = await db
    .update(monitoringClusters)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(monitoringClusters.id, id))
    .returning(CLUSTER_SAFE_COLUMNS);
  return row ?? null;
}

export async function deleteCluster(id: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringClusters)
    .where(eq(monitoringClusters.id, id))
    .returning({ id: monitoringClusters.id });
  return rows.length > 0;
}

// ---- Workload inventory ----

export interface WorkloadRow {
  kind: WorkloadKind;
  namespace: string;
  name: string;
  replicas: number | null;
  /** EFFECTIVE technology: the admin's override where set, else the detected one. */
  technology: WorkloadTechnology | null;
  /** What detection inferred, kept so the UI can show a guess being corrected. */
  technologyDetected: WorkloadTechnology | null;
  technologyReason: string | null;
  technologyOverride: WorkloadTechnology | null;
  /** True when a deep assessment has a playbook for `technology`. */
  profiled: boolean;
  lastSeenAt: Date;
}

/** The technology that actually applies: a human's answer beats a guess. */
function effectiveTechnology(row: {
  technology: WorkloadTechnology | null;
  technologyOverride: WorkloadTechnology | null;
}): WorkloadTechnology | null {
  return row.technologyOverride ?? row.technology;
}

/**
 * The inventory, optionally narrowed and capped.
 *
 * The options exist for the cluster page, which shows a page of rows rather than
 * all of them: a real cluster has hundreds of workloads (the one this was built
 * against has 464), and rendering every row — or shipping every row to a browser
 * so it can filter them there — costs far more than the lookup anyone actually
 * came to do. Callers that genuinely need the whole inventory (the job form's
 * target picker) use `listWorkloads` and get today's behaviour.
 *
 * `matching` is the count BEFORE the limit, so the UI can say what it is hiding.
 */
export interface WorkloadPage {
  workloads: WorkloadRow[];
  /** Rows matching the search, before `limit` is applied. */
  matching: number;
  /** Everything in the cluster, ignoring the search. */
  total: number;
}

export async function listWorkloadPage(
  clusterId: string,
  options: { search?: string; limit?: number } = {},
): Promise<WorkloadPage> {
  const search = options.search?.trim().toLowerCase();
  const owned = eq(monitoringWorkloads.clusterId, clusterId);
  // Matched in SQL so a big cluster never loads its whole inventory to show a
  // page of it. The effective technology is included because "show me the
  // postgres ones" is the search people actually type.
  const matches = search
    ? and(
        owned,
        sql`(lower(${monitoringWorkloads.namespace}) like ${"%" + search + "%"}
          or lower(${monitoringWorkloads.name}) like ${"%" + search + "%"}
          or lower(coalesce(${monitoringWorkloads.technologyOverride},
                            ${monitoringWorkloads.technology}, '')) like ${"%" + search + "%"})`,
      )
    : owned;

  const [workloads, matchingRows, totalRows] = await Promise.all([
    listWorkloadsWhere(matches, options.limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(monitoringWorkloads)
      .where(matches),
    search
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(monitoringWorkloads)
          .where(owned)
      : Promise.resolve([{ n: 0 }]),
  ]);

  const matching = matchingRows[0]?.n ?? 0;
  return {
    workloads,
    matching,
    total: search ? (totalRows[0]?.n ?? 0) : matching,
  };
}

export async function listWorkloads(clusterId: string): Promise<WorkloadRow[]> {
  return listWorkloadsWhere(eq(monitoringWorkloads.clusterId, clusterId));
}

async function listWorkloadsWhere(
  where: ReturnType<typeof eq> | undefined,
  limit?: number,
): Promise<WorkloadRow[]> {
  const query = db
    .select({
      kind: monitoringWorkloads.kind,
      namespace: monitoringWorkloads.namespace,
      name: monitoringWorkloads.name,
      replicas: monitoringWorkloads.replicas,
      // `images` is deliberately NOT selected. Detection reads images straight
      // from the cluster (lib/monitoring/discovery.ts) and nothing renders them,
      // so selecting them here only put an image list per workload on the wire —
      // hundreds of rows' worth on a real cluster.
      technology: monitoringWorkloads.technology,
      technologyReason: monitoringWorkloads.technologyReason,
      technologyOverride: monitoringWorkloads.technologyOverride,
      lastSeenAt: monitoringWorkloads.lastSeenAt,
    })
    .from(monitoringWorkloads)
    .where(where)
    .orderBy(
      asc(monitoringWorkloads.namespace),
      asc(monitoringWorkloads.kind),
      asc(monitoringWorkloads.name),
    );
  const rows = await (limit ? query.limit(limit) : query);
  // Resolved here rather than in the routes, so every consumer of the inventory
  // agrees on what a workload IS and on whether a deep run has a method for it.
  return rows.map((row) => {
    const technology = effectiveTechnology(row);
    return {
      ...row,
      technology,
      technologyDetected: row.technology,
      profiled: technology !== null && PROFILED_TECHNOLOGIES.includes(technology),
    };
  });
}

/**
 * Correct a workload's detected technology by hand. Stored separately from the
 * detected value so re-discovery cannot revert it — detection cannot see inside a
 * privately-built image, so the human answer has to be the durable one.
 */
export async function setWorkloadTechnology(
  clusterId: string,
  // A workload identity, deliberately not an AssessmentTarget: this table can only
  // ever hold Deployments and StatefulSets, and the type is what says so.
  target: { kind: WorkloadKind; namespace: string; name: string },
  technology: WorkloadTechnology | null,
): Promise<boolean> {
  const rows = await db
    .update(monitoringWorkloads)
    .set({ technologyOverride: technology })
    .where(
      and(
        eq(monitoringWorkloads.clusterId, clusterId),
        eq(monitoringWorkloads.kind, target.kind),
        eq(monitoringWorkloads.namespace, target.namespace),
        eq(monitoringWorkloads.name, target.name),
      ),
    )
    .returning({ id: monitoringWorkloads.id });
  return rows.length > 0;
}

/**
 * Replace a cluster's inventory with what discovery just saw: upsert every
 * workload (re-stamping `lastSeenAt`) and delete the rows it did not see, in
 * one transaction so the picker never observes a half-empty cluster.
 */
export async function replaceWorkloads(
  clusterId: string,
  workloads: {
    kind: WorkloadKind;
    namespace: string;
    name: string;
    replicas: number | null;
    images: string[];
    technology: WorkloadTechnology | null;
    technologyReason: string | null;
  }[],
): Promise<{ total: number; removed: number }> {
  return db.transaction(async (tx) => {
    const seenAt = new Date();
    if (workloads.length > 0) {
      // Chunked: a cluster with thousands of workloads would otherwise blow
      // past Postgres's bind-parameter limit in a single INSERT.
      const CHUNK = 500;
      for (let i = 0; i < workloads.length; i += CHUNK) {
        await tx
          .insert(monitoringWorkloads)
          .values(
            workloads.slice(i, i + CHUNK).map((w) => ({
              clusterId,
              ...w,
              lastSeenAt: seenAt,
            })),
          )
          .onConflictDoUpdate({
            target: [
              monitoringWorkloads.clusterId,
              monitoringWorkloads.kind,
              monitoringWorkloads.namespace,
              monitoringWorkloads.name,
            ],
            set: {
              replicas: sql`excluded.replicas`,
              images: sql`excluded.images`,
              // Re-derived every discovery, like the rest of this cache. Note
              // `technology_override` is deliberately absent: an admin's
              // correction must survive a re-scan that would guess wrong again.
              technology: sql`excluded.technology`,
              technologyReason: sql`excluded.technology_reason`,
              lastSeenAt: sql`excluded.last_seen_at`,
            },
          });
      }
    }
    const removed = await tx
      .delete(monitoringWorkloads)
      .where(
        and(
          eq(monitoringWorkloads.clusterId, clusterId),
          // `lt()`, not a raw sql template: the template does not apply the
          // column's type mapper, so a JS Date reaches Postgres as
          // "Mon Aug 10 2026 …" and the query fails.
          lt(monitoringWorkloads.lastSeenAt, seenAt),
        ),
      )
      .returning({ id: monitoringWorkloads.id });
    await tx
      .update(monitoringClusters)
      .set({ lastDiscoveredAt: seenAt, discoveryError: null })
      .where(eq(monitoringClusters.id, clusterId));
    return { total: workloads.length, removed: removed.length };
  });
}

export async function recordDiscoveryError(clusterId: string, error: string) {
  await db
    .update(monitoringClusters)
    .set({ discoveryError: error.slice(0, 2000) })
    .where(eq(monitoringClusters.id, clusterId));
}

// ---- Jobs ----

export interface JobRow {
  id: string;
  clusterId: string;
  name: string;
  type: MonitorCategory;
  depth: MonitorDepth;
  model: string;
  schedule: string | null;
  enabled: boolean;
  nextRunAt: Date | null;
  createdAt: Date;
}

export interface JobListRow extends JobRow {
  targetCount: number;
  openConcerns: number;
  criticalConcerns: number;
  lastRunAt: Date | null;
}

/** Plain qualified SQL, for the reason documented on `listClusters` above. */
const JOB_LIST_EXTRAS = {
  targetCount: sql<number>`(select count(*)::int from monitoring_job_targets t
    where t.job_id = monitoring_jobs.id)`,
  openConcerns: sql<number>`(select count(*)::int from monitoring_concerns c
    where c.job_id = monitoring_jobs.id and c.status = 'open')`,
  criticalConcerns: sql<number>`(select count(*)::int from monitoring_concerns c
    where c.job_id = monitoring_jobs.id and c.status = 'open'
      and c.effective_severity = 'critical')`,
  lastRunAt: sql<Date | null>`(select max(r.finished_at) from monitoring_runs r
    where r.job_id = monitoring_jobs.id)`,
};

/** Every job, grouped by cluster — feeds the module's tree sidebar. */
export async function listJobs(clusterId?: string): Promise<JobListRow[]> {
  return db
    .select({
      id: monitoringJobs.id,
      clusterId: monitoringJobs.clusterId,
      name: monitoringJobs.name,
      type: monitoringJobs.type,
      depth: monitoringJobs.depth,
      model: monitoringJobs.model,
      schedule: monitoringJobs.schedule,
      enabled: monitoringJobs.enabled,
      nextRunAt: monitoringJobs.nextRunAt,
      createdAt: monitoringJobs.createdAt,
      ...JOB_LIST_EXTRAS,
    })
    .from(monitoringJobs)
    .where(clusterId ? eq(monitoringJobs.clusterId, clusterId) : undefined)
    .orderBy(asc(monitoringJobs.name));
}

export interface JobDetail extends JobRow {
  targets: AssessmentTarget[];
}

export async function getJob(id: string): Promise<JobDetail | null> {
  const [job] = await db
    .select()
    .from(monitoringJobs)
    .where(eq(monitoringJobs.id, id))
    .limit(1);
  if (!job) return null;
  return { ...job, targets: await getJobTargets(id) };
}

export async function getJobTargets(
  jobId: string,
): Promise<AssessmentTarget[]> {
  return db
    .select({
      kind: monitoringJobTargets.kind,
      namespace: monitoringJobTargets.namespace,
      name: monitoringJobTargets.name,
    })
    .from(monitoringJobTargets)
    .where(eq(monitoringJobTargets.jobId, jobId))
    .orderBy(asc(monitoringJobTargets.namespace), asc(monitoringJobTargets.name));
}

export async function createJob(
  input: {
    clusterId: string;
    name: string;
    type: MonitorCategory;
    depth: MonitorDepth;
    model: string;
    schedule: string | null;
    enabled: boolean;
    nextRunAt: Date | null;
    createdBy: string;
  },
  targets: AssessmentTarget[],
): Promise<JobDetail> {
  return db.transaction(async (tx) => {
    const [job] = await tx.insert(monitoringJobs).values(input).returning();
    if (targets.length > 0) {
      await tx
        .insert(monitoringJobTargets)
        .values(targets.map((t) => ({ jobId: job.id, ...t })));
    }
    return { ...job, targets };
  });
}

export async function updateJob(
  id: string,
  fields: Partial<{
    name: string;
    model: string;
    depth: MonitorDepth;
    schedule: string | null;
    enabled: boolean;
    nextRunAt: Date | null;
  }>,
  targets?: AssessmentTarget[],
): Promise<JobDetail | null> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .update(monitoringJobs)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(monitoringJobs.id, id))
      .returning();
    if (!job) return null;
    if (targets) {
      await tx
        .delete(monitoringJobTargets)
        .where(eq(monitoringJobTargets.jobId, id));
      if (targets.length > 0) {
        await tx
          .insert(monitoringJobTargets)
          .values(targets.map((t) => ({ jobId: id, ...t })));
      }
    }
    return {
      ...job,
      targets:
        targets ??
        (await tx
          .select({
            kind: monitoringJobTargets.kind,
            namespace: monitoringJobTargets.namespace,
            name: monitoringJobTargets.name,
          })
          .from(monitoringJobTargets)
          .where(eq(monitoringJobTargets.jobId, id))),
    };
  });
}

export async function deleteJob(id: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringJobs)
    .where(eq(monitoringJobs.id, id))
    .returning({ id: monitoringJobs.id });
  return rows.length > 0;
}

/**
 * A job's targets with the technology the inventory believes each one runs.
 *
 * A LEFT JOIN, because targets are denormalised on purpose (decision 43): the job's
 * intent is "the StatefulSet named X in namespace Y", which must survive discovery
 * deleting and recreating inventory rows. A target with no matching row has simply
 * vanished from the cluster, and comes back with a null technology — which the
 * runner reports rather than hides.
 */
export async function getResolvedJobTargets(
  jobId: string,
): Promise<ResolvedTarget[]> {
  const rows = await db
    .select({
      kind: monitoringJobTargets.kind,
      namespace: monitoringJobTargets.namespace,
      name: monitoringJobTargets.name,
      technology: monitoringWorkloads.technology,
      technologyOverride: monitoringWorkloads.technologyOverride,
    })
    .from(monitoringJobTargets)
    .innerJoin(
      monitoringJobs,
      eq(monitoringJobs.id, monitoringJobTargets.jobId),
    )
    .leftJoin(
      monitoringWorkloads,
      and(
        eq(monitoringWorkloads.clusterId, monitoringJobs.clusterId),
        eq(monitoringWorkloads.kind, monitoringJobTargets.kind),
        eq(monitoringWorkloads.namespace, monitoringJobTargets.namespace),
        eq(monitoringWorkloads.name, monitoringJobTargets.name),
      ),
    )
    .where(eq(monitoringJobTargets.jobId, jobId))
    .orderBy(asc(monitoringJobTargets.namespace), asc(monitoringJobTargets.name));
  return rows.map(({ technology, technologyOverride, ...target }) => ({
    ...target,
    // The cluster's technology is implied by its kind. There is no inventory row for
    // it to have been detected on and no human override to respect, and without this
    // it would resolve to null — which means "no playbook" and, because every cluster
    // check is scoped to `kubernetes`, an empty rubric and a failed run.
    technology: isClusterTarget(target)
      ? CLUSTER_TECHNOLOGY
      : effectiveTechnology({ technology, technologyOverride }),
  }));
}

/** Everything the runner needs for one job, in one round trip. */
export async function getJobExecutionContext(jobId: string) {
  const [row] = await db
    .select({ job: monitoringJobs, cluster: monitoringClusters })
    .from(monitoringJobs)
    .innerJoin(
      monitoringClusters,
      eq(monitoringClusters.id, monitoringJobs.clusterId),
    )
    .where(eq(monitoringJobs.id, jobId))
    .limit(1);
  if (!row) return null;
  return { ...row, targets: await getResolvedJobTargets(jobId) };
}

// ---- Runs / queue ----

export interface RunRow {
  id: string;
  jobId: string;
  status: string;
  trigger: RunTrigger;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  costUsd: number | null;
  totalTokens: number | null;
  model: string | null;
  toolCallsTotal: number | null;
  toolCallsFailed: number | null;
  findingsNew: number | null;
  findingsResolved: number | null;
  findingsOpen: number | null;
  error: string | null;
  createdAt: Date;
}

const RUN_LIST_COLUMNS = {
  id: monitoringRuns.id,
  jobId: monitoringRuns.jobId,
  status: monitoringRuns.status,
  trigger: monitoringRuns.trigger,
  startedAt: monitoringRuns.startedAt,
  finishedAt: monitoringRuns.finishedAt,
  durationMs: monitoringRuns.durationMs,
  costUsd: monitoringRuns.costUsd,
  totalTokens: monitoringRuns.totalTokens,
  model: monitoringRuns.model,
  toolCallsTotal: monitoringRuns.toolCallsTotal,
  toolCallsFailed: monitoringRuns.toolCallsFailed,
  findingsNew: monitoringRuns.findingsNew,
  findingsResolved: monitoringRuns.findingsResolved,
  findingsOpen: monitoringRuns.findingsOpen,
  error: monitoringRuns.error,
  createdAt: monitoringRuns.createdAt,
};

export async function enqueueRun(input: {
  jobId: string;
  trigger: RunTrigger;
  triggeredBy: string | null;
}): Promise<RunRow> {
  const [row] = await db
    .insert(monitoringRuns)
    .values(input)
    .returning(RUN_LIST_COLUMNS);
  return row;
}

/**
 * Atomically claim up to `limit` queued runs. `FOR UPDATE SKIP LOCKED` is what
 * makes overlapping scheduler ticks (and, later, multiple worker replicas)
 * safe: a row can only be claimed once.
 */
export async function claimQueuedRuns(
  limit: number,
): Promise<{ id: string; jobId: string }[]> {
  const rows = await db.execute(sql`
    update ${monitoringRuns} set
      status = 'running',
      claimed_at = now(),
      started_at = now(),
      attempt = ${monitoringRuns.attempt} + 1
    where id in (
      select id from ${monitoringRuns}
      where status = 'queued'
      order by created_at
      limit ${limit}
      for update skip locked
    )
    returning id, job_id
  `);
  return (rows as unknown as { id: string; job_id: string }[]).map((r) => ({
    id: r.id,
    jobId: r.job_id,
  }));
}

/**
 * Claim ONE specific run — what the "Run now" button needs, since the generic
 * queue drain would happily pick up somebody else's older queued run instead.
 * Returns null when the run is already claimed or no longer queued.
 */
export async function claimRun(
  runId: string,
): Promise<{ id: string; jobId: string } | null> {
  const rows = await db.execute(sql`
    update ${monitoringRuns} set
      status = 'running',
      claimed_at = now(),
      started_at = now(),
      attempt = ${monitoringRuns.attempt} + 1
    where id = ${runId} and status = 'queued'
    returning id, job_id
  `);
  const claimed = (rows as unknown as { id: string; job_id: string }[])[0];
  return claimed ? { id: claimed.id, jobId: claimed.job_id } : null;
}

export async function failRun(
  id: string,
  error: string,
  extra: Partial<{
    costUsd: number;
    totalTokens: number;
    durationMs: number;
    model: string;
    rawResponse: unknown;
    toolCallsTotal: number;
    toolCallsFailed: number;
  }> = {},
) {
  await db
    .update(monitoringRuns)
    .set({
      status: "failed",
      error: error.slice(0, 4000),
      finishedAt: new Date(),
      ...extra,
    })
    .where(eq(monitoringRuns.id, id));
}

/**
 * Crash recovery: a pod that dies mid-run leaves the row `running` forever.
 * Called at the top of every scheduler tick.
 *
 * The threshold is per depth, because the two depths have honestly different
 * plausible durations: a posture run is one Holmes call, while a deep run is one
 * call per workload and legitimately takes far longer. Using the posture threshold
 * for both would reap healthy deep runs mid-flight and then re-enqueue them, which
 * is a way to spend money on assessments that are thrown away.
 */
export async function reapStaleRuns(thresholds: {
  postureMs: number;
  deepMs: number;
}): Promise<number> {
  const now = Date.now();
  const counts = await Promise.all(
    (
      [
        ["posture", thresholds.postureMs],
        ["deep", thresholds.deepMs],
      ] as const
    ).map(([depth, ms]) => reapRunsForDepth(depth, new Date(now - ms))),
  );
  return counts.reduce((total, n) => total + n, 0);
}

/**
 * Deliberately two statements with `lt()` and a subquery rather than one with a
 * raw `case` expression: a JS `Date` interpolated into a raw `sql` template does
 * NOT get the column's type mapper applied and reaches Postgres as
 * "Mon Aug 10 2026 …" (docs/DECISIONS.md 53 — this exact bug broke the original
 * reaper).
 */
async function reapRunsForDepth(
  depth: MonitorDepth,
  cutoff: Date,
): Promise<number> {
  const rows = await db
    .update(monitoringRuns)
    .set({
      status: "failed",
      error: "Run abandoned — the executing process disappeared",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(monitoringRuns.status, "running"),
        lt(monitoringRuns.startedAt, cutoff),
        inArray(
          monitoringRuns.jobId,
          db
            .select({ id: monitoringJobs.id })
            .from(monitoringJobs)
            .where(eq(monitoringJobs.depth, depth)),
        ),
      ),
    )
    .returning({ id: monitoringRuns.id });
  return rows.length;
}

/**
 * The state of a job's most recent run, and nothing else — what "Run now" polls.
 *
 * Covered by `monitoring_runs_job_idx`; see the route for what this replaced.
 */
export async function latestRunStatus(
  jobId: string,
): Promise<{ active: boolean; status: string | null; error: string | null }> {
  const [row] = await db
    .select({
      status: monitoringRuns.status,
      error: monitoringRuns.error,
    })
    .from(monitoringRuns)
    .where(eq(monitoringRuns.jobId, jobId))
    .orderBy(desc(monitoringRuns.createdAt))
    .limit(1);
  if (!row) return { active: false, status: null, error: null };
  return {
    active: row.status === "queued" || row.status === "running",
    status: row.status,
    error: row.error,
  };
}

export async function listRuns(jobId: string, limit = 50): Promise<RunRow[]> {
  return db
    .select(RUN_LIST_COLUMNS)
    .from(monitoringRuns)
    .where(eq(monitoringRuns.jobId, jobId))
    .orderBy(desc(monitoringRuns.createdAt))
    .limit(limit);
}

export async function getRun(id: string) {
  const [row] = await db
    .select({
      ...RUN_LIST_COLUMNS,
      coverage: monitoringRuns.coverage,
      rejected: monitoringRuns.rejected,
      expectedObservations: monitoringRuns.expectedObservations,
      // `prompts` is NOT selected: a deep run stores one verbatim prompt per
      // workload at ~20 KB each, and the page indexes them (`runPromptIndex`) and
      // loads one at a time instead of shipping the lot.
      attempt: monitoringRuns.attempt,
    })
    .from(monitoringRuns)
    .where(eq(monitoringRuns.id, id))
    .limit(1);
  return row ?? null;
}

/** A run's measured facts, ordered so one workload's readings stay together. */
/**
 * The run's prompts, by label and size only — never their text.
 *
 * Done in SQL so a page that lists ten prompts does not pull a couple of hundred
 * kilobytes of them into the server render either.
 */
export async function runPromptIndex(
  runId: string,
): Promise<{ index: number; target: string; bytes: number }[]> {
  const rows = await db.execute<{
    index: number;
    target: string;
    bytes: number;
  }>(sql`
    select (p.ordinality - 1)::int as index,
           p.value->>'target' as target,
           length(p.value->>'prompt')::int as bytes
    from monitoring_runs r,
         jsonb_array_elements(coalesce(r.prompts, '[]'::jsonb))
           with ordinality as p(value, ordinality)
    where r.id = ${runId}
    order by p.ordinality
  `);
  return [...rows];
}

/** One stored prompt, by its position in the run's list. */
export async function getRunPrompt(
  runId: string,
  index: number,
): Promise<string | null> {
  // The ::int cast is load-bearing. Bound as text, the -> operator takes its
  // object-key overload and silently returns null for a JSON array.
  const rows = await db.execute<{ prompt: string | null }>(sql`
    select prompts->(${index}::int)->>'prompt' as prompt
    from monitoring_runs where id = ${runId}
  `);
  return rows[0]?.prompt ?? null;
}

export async function getRunObservations(runId: string) {
  return db
    .select({
      targetKind: monitoringObservations.targetKind,
      targetNamespace: monitoringObservations.targetNamespace,
      targetName: monitoringObservations.targetName,
      key: monitoringObservations.key,
      value: monitoringObservations.value,
      numeric: monitoringObservations.numeric,
      unit: monitoringObservations.unit,
      source: monitoringObservations.source,
    })
    .from(monitoringObservations)
    .where(eq(monitoringObservations.runId, runId))
    .orderBy(
      asc(monitoringObservations.targetName),
      asc(monitoringObservations.key),
    );
}

/** The concerns this run reported, with the severity as observed then. */
export async function getRunFindings(runId: string) {
  return db
    .select({
      concernId: monitoringConcerns.id,
      checkId: monitoringConcerns.checkId,
      severity: monitoringRunFindings.severity,
      isNew: monitoringRunFindings.isNew,
      title: monitoringConcerns.title,
      rationale: monitoringConcerns.rationale,
      remediation: monitoringConcerns.remediation,
      evidence: monitoringConcerns.evidence,
      scope: monitoringConcerns.scope,
      status: monitoringConcerns.status,
      targetKind: monitoringConcerns.targetKind,
      targetNamespace: monitoringConcerns.targetNamespace,
      targetName: monitoringConcerns.targetName,
      baseSeverity: monitoringConcerns.baseSeverity,
      severityRationale: monitoringConcerns.severityRationale,
      firstSeenAt: monitoringConcerns.firstSeenAt,
      occurrenceCount: monitoringConcerns.occurrenceCount,
    })
    .from(monitoringRunFindings)
    .innerJoin(
      monitoringConcerns,
      eq(monitoringConcerns.id, monitoringRunFindings.concernId),
    )
    .where(eq(monitoringRunFindings.runId, runId));
}

// ---- Scheduling ----

/** Enabled jobs with a cron schedule whose next run is due. */
export async function dueJobs(now: Date) {
  return db
    .select({
      id: monitoringJobs.id,
      schedule: monitoringJobs.schedule,
      nextRunAt: monitoringJobs.nextRunAt,
    })
    .from(monitoringJobs)
    .where(
      and(
        eq(monitoringJobs.enabled, true),
        isNotNull(monitoringJobs.schedule),
        isNotNull(monitoringJobs.nextRunAt),
        lte(monitoringJobs.nextRunAt, now),
      ),
    );
}

export async function setNextRunAt(jobId: string, nextRunAt: Date | null) {
  await db
    .update(monitoringJobs)
    .set({ nextRunAt })
    .where(eq(monitoringJobs.id, jobId));
}

/**
 * Skip a job whose previous run is still queued or running — a slow
 * investigation must never stack up behind itself.
 */
export async function hasActiveRun(jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(monitoringRuns)
    .where(
      and(
        eq(monitoringRuns.jobId, jobId),
        inArray(monitoringRuns.status, ["queued", "running"]),
      ),
    );
  return (row?.n ?? 0) > 0;
}

// ---- Concerns ----

export interface ConcernRow {
  id: string;
  jobId: string;
  fingerprint: string;
  checkId: string;
  checkVersion: number;
  category: MonitorCategory;
  targetKind: TargetKind;
  targetNamespace: string;
  targetName: string;
  scope: string;
  baseSeverity: Severity;
  effectiveSeverity: Severity;
  severityRationale: string | null;
  status: ConcernStatus;
  title: string;
  rationale: string;
  remediation: string;
  evidence: { label: string; value: string }[];
  contentHash: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastResolvedAt: Date | null;
  severityChangedAt: Date | null;
  occurrenceCount: number;
  consecutiveRunsAbsent: number;
  mutedUntil: Date | null;
  dismissalReason: string | null;
  dismissalComment: string | null;
}

/**
 * A concern as a LIST needs it: everything the card shows, and none of the
 * identity machinery.
 *
 * `fingerprint`, `contentHash`, `checkVersion`, `category` and the absent-run
 * counters exist for reconciliation (`concernsForJob`, which still reads the full
 * row). They were being selected and serialised for every concern of every job on
 * a page that cannot use any of them.
 */
export type ConcernListRow = Omit<
  ConcernRow,
  | "fingerprint"
  | "contentHash"
  | "checkVersion"
  | "category"
  | "lastResolvedAt"
  | "severityChangedAt"
  | "consecutiveRunsAbsent"
>;

export async function listConcerns(
  jobId: string,
  filters: { statuses?: ConcernStatus[]; severities?: Severity[] } = {},
): Promise<ConcernListRow[]> {
  const conditions = [eq(monitoringConcerns.jobId, jobId)];
  if (filters.statuses?.length)
    conditions.push(inArray(monitoringConcerns.status, filters.statuses));
  if (filters.severities?.length)
    conditions.push(
      inArray(monitoringConcerns.effectiveSeverity, filters.severities),
    );
  return db
    // A projection, not `select()`. `fingerprint` and `contentHash` are identity
    // machinery — the client has no use for either, and they were on the wire for
    // every concern of every job.
    .select({
      id: monitoringConcerns.id,
      jobId: monitoringConcerns.jobId,
      checkId: monitoringConcerns.checkId,
      targetKind: monitoringConcerns.targetKind,
      targetNamespace: monitoringConcerns.targetNamespace,
      targetName: monitoringConcerns.targetName,
      scope: monitoringConcerns.scope,
      baseSeverity: monitoringConcerns.baseSeverity,
      effectiveSeverity: monitoringConcerns.effectiveSeverity,
      severityRationale: monitoringConcerns.severityRationale,
      status: monitoringConcerns.status,
      title: monitoringConcerns.title,
      rationale: monitoringConcerns.rationale,
      remediation: monitoringConcerns.remediation,
      evidence: monitoringConcerns.evidence,
      firstSeenAt: monitoringConcerns.firstSeenAt,
      lastSeenAt: monitoringConcerns.lastSeenAt,
      occurrenceCount: monitoringConcerns.occurrenceCount,
      mutedUntil: monitoringConcerns.mutedUntil,
      dismissalReason: monitoringConcerns.dismissalReason,
      dismissalComment: monitoringConcerns.dismissalComment,
    })
    .from(monitoringConcerns)
    .where(and(...conditions))
    .orderBy(
      // Severity is text, so order it explicitly rather than alphabetically.
      sql`case ${monitoringConcerns.effectiveSeverity}
            when 'critical' then 0 when 'high' then 1 when 'medium' then 2
            when 'low' then 3 else 4 end`,
      desc(monitoringConcerns.lastSeenAt),
    );
}

export async function getConcern(id: string): Promise<ConcernRow | null> {
  const [row] = await db
    .select()
    .from(monitoringConcerns)
    .where(eq(monitoringConcerns.id, id))
    .limit(1);
  return row ?? null;
}

/** Per-run severity history for one concern — the flap/drift timeline. */
export async function getConcernHistory(concernId: string) {
  return db
    .select({
      runId: monitoringRuns.id,
      severity: monitoringRunFindings.severity,
      isNew: monitoringRunFindings.isNew,
      at: monitoringRuns.finishedAt,
      trigger: monitoringRuns.trigger,
    })
    .from(monitoringRunFindings)
    .innerJoin(
      monitoringRuns,
      eq(monitoringRuns.id, monitoringRunFindings.runId),
    )
    .where(eq(monitoringRunFindings.concernId, concernId))
    .orderBy(desc(monitoringRuns.createdAt))
    .limit(50);
}

export async function setConcernLifecycle(
  id: string,
  fields: {
    status: ConcernStatus;
    dismissalReason?: string | null;
    dismissalComment?: string | null;
    dismissedBy?: string | null;
    mutedUntil?: Date | null;
    lastResolvedAt?: Date | null;
    consecutiveRunsAbsent?: number;
  },
): Promise<ConcernRow | null> {
  const [row] = await db
    .update(monitoringConcerns)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(monitoringConcerns.id, id))
    .returning();
  return row ?? null;
}

/**
 * Concerns that a reconciliation pass needs to consider: every non-dismissed
 * row for this job whose check the run evaluated, plus dismissed rows (so
 * `lastSeenAt` still advances) — the caller decides what to do with each.
 */
export async function concernsForJob(jobId: string): Promise<ConcernRow[]> {
  return db
    .select()
    .from(monitoringConcerns)
    .where(eq(monitoringConcerns.jobId, jobId));
}

/** Expire mute windows that have elapsed, so the concern is visible again. */
export async function unmuteExpired(): Promise<number> {
  const rows = await db
    .update(monitoringConcerns)
    .set({ status: "open", mutedUntil: null, updatedAt: new Date() })
    .where(
      and(
        eq(monitoringConcerns.status, "muted"),
        sql`${monitoringConcerns.mutedUntil} is not null`,
        sql`${monitoringConcerns.mutedUntil} <= now()`,
      ),
    )
    .returning({ id: monitoringConcerns.id });
  return rows.length;
}

// ---- Reconciliation (executes a plan built by lib/monitoring/reconcile.ts) ----

export interface ConcernUpsert {
  fingerprint: string;
  checkId: string;
  checkVersion: number;
  category: MonitorCategory;
  targetKind: TargetKind;
  targetNamespace: string;
  targetName: string;
  scope: string;
  baseSeverity: Severity;
  effectiveSeverity: Severity;
  severityRationale: string;
  title: string;
  rationale: string;
  remediation: string;
  evidence: { label: string; value: string }[];
  contentHash: string;
}

export interface ReconcilePlan {
  /** Concerns seen failing in this run — insert or refresh. */
  present: ConcernUpsert[];
  /** Concern ids whose check was evaluated and did NOT fail. */
  absentIds: string[];
  /** Concern ids that crossed their absent-run threshold. */
  autoResolveIds: string[];
  /** Fingerprints whose severity moved, for `severityChangedAt`. */
  severityChanged: Set<string>;
}

export interface ReconcileResult {
  newCount: number;
  resolvedCount: number;
  openCount: number;
}

/**
 * Apply a reconciliation plan and finish the run, in ONE transaction — a crash
 * mid-way leaves the run `running` for the reaper rather than a half-updated
 * concern history.
 */
export async function applyReconcilePlan(
  runId: string,
  jobId: string,
  plan: ReconcilePlan,
  runFields: {
    coverage: RunCoverage;
    /** Measured facts; stored in their own table, not on the run row. */
    observations: readonly AssessmentObservation[];
    rejected: string[];
    rawResponse: unknown;
    /** What the run was told to measure — snapshotted, see the column's comment. */
    expectedObservations: ExpectedObservations[] | null;
    prompts: { target: string; prompt: string }[];
    model: string;
    costUsd: number | null;
    totalTokens: number | null;
    durationMs: number;
    toolCallsTotal: number;
    toolCallsFailed: number;
  },
): Promise<ReconcileResult> {
  const { observations, ...runColumns } = runFields;
  return db.transaction(async (tx) => {
    const now = new Date();
    let newCount = 0;

    for (const c of plan.present) {
      const [existing] = await tx
        .select({
          id: monitoringConcerns.id,
          status: monitoringConcerns.status,
          firstSeenAt: monitoringConcerns.firstSeenAt,
        })
        .from(monitoringConcerns)
        .where(
          and(
            eq(monitoringConcerns.jobId, jobId),
            eq(monitoringConcerns.fingerprint, c.fingerprint),
          ),
        )
        .limit(1);

      const severityMoved = plan.severityChanged.has(c.fingerprint);

      if (!existing) {
        const [row] = await tx
          .insert(monitoringConcerns)
          .values({
            jobId,
            ...c,
            status: "open",
            firstSeenAt: now,
            lastSeenAt: now,
            occurrenceCount: 1,
            firstSeenRunId: runId,
            lastSeenRunId: runId,
          })
          .returning({ id: monitoringConcerns.id });
        await tx.insert(monitoringRunFindings).values({
          runId,
          concernId: row.id,
          severity: c.effectiveSeverity,
          isNew: true,
        });
        newCount++;
        continue;
      }

      // A human decision (muted / accepted_risk / false_positive) survives:
      // the concern is still recorded as seen, but never silently reopened.
      const humanDismissed = DISMISSED_STATUSES.includes(existing.status);
      await tx
        .update(monitoringConcerns)
        .set({
          effectiveSeverity: c.effectiveSeverity,
          severityRationale: c.severityRationale,
          title: c.title,
          rationale: c.rationale,
          remediation: c.remediation,
          evidence: c.evidence,
          contentHash: c.contentHash,
          baseSeverity: c.baseSeverity,
          checkVersion: c.checkVersion,
          lastSeenAt: now,
          lastSeenRunId: runId,
          occurrenceCount: sql`${monitoringConcerns.occurrenceCount} + 1`,
          consecutiveRunsAbsent: 0,
          ...(severityMoved ? { severityChangedAt: now } : {}),
          ...(humanDismissed ? {} : { status: "open" as const }),
          updatedAt: now,
        })
        .where(eq(monitoringConcerns.id, existing.id));
      await tx
        .insert(monitoringRunFindings)
        .values({
          runId,
          concernId: existing.id,
          severity: c.effectiveSeverity,
          isNew: false,
        })
        .onConflictDoNothing();
    }

    if (plan.absentIds.length > 0) {
      await tx
        .update(monitoringConcerns)
        .set({
          consecutiveRunsAbsent: sql`${monitoringConcerns.consecutiveRunsAbsent} + 1`,
          updatedAt: now,
        })
        .where(inArray(monitoringConcerns.id, plan.absentIds));
    }

    if (plan.autoResolveIds.length > 0) {
      await tx
        .update(monitoringConcerns)
        .set({ status: "auto_resolved", lastResolvedAt: now, updatedAt: now })
        .where(
          and(
            inArray(monitoringConcerns.id, plan.autoResolveIds),
            eq(monitoringConcerns.status, "open"),
          ),
        );
    }

    const [openRow] = await tx
      .select({ n: count() })
      .from(monitoringConcerns)
      .where(
        and(
          eq(monitoringConcerns.jobId, jobId),
          eq(monitoringConcerns.status, "open"),
        ),
      );
    const openCount = openRow?.n ?? 0;

    if (observations.length > 0) {
      // Chunked for the same reason as workload discovery: a deep run over many
      // workloads produces enough rows to pass Postgres's bind-parameter limit.
      // `onConflictDoNothing` on (run, target, key) drops a key the model restated
      // rather than failing the whole transaction over it.
      const CHUNK = 500;
      for (let i = 0; i < observations.length; i += CHUNK) {
        await tx
          .insert(monitoringObservations)
          .values(
            observations.slice(i, i + CHUNK).map((o) => ({
              runId,
              jobId,
              targetKind: o.target.kind,
              targetNamespace: o.target.namespace,
              targetName: o.target.name,
              key: o.key,
              value: o.value,
              numeric: o.numeric,
              unit: o.unit,
              source: o.source,
              createdAt: now,
            })),
          )
          .onConflictDoNothing();
      }
    }

    await tx
      .update(monitoringRuns)
      .set({
        status: "completed",
        finishedAt: now,
        findingsNew: newCount,
        findingsResolved: plan.autoResolveIds.length,
        findingsOpen: openCount,
        ...runColumns,
      })
      .where(eq(monitoringRuns.id, runId));

    return {
      newCount,
      resolvedCount: plan.autoResolveIds.length,
      openCount,
    };
  });
}
