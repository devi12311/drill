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
  notInArray,
  or,
  sql,
  TransactionRollbackError,
  type SQL,
} from "drizzle-orm";
import { db } from "./index";
import { openSecret, sealSecret } from "@/lib/secrets";
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
  monitoringRunTargets,
  monitoringRuns,
  monitoringWorkloadTypes,
  monitoringWorkloads,
} from "./schema";
import {
  ACTIVE_RUN_STATUSES,
  CLUSTER_TECHNOLOGY,
  DISMISSED_STATUSES,
  isClusterTarget,
  isUuid,
} from "@/lib/monitoring/types";
import type { ExpectedObservations } from "@/lib/monitoring/playbook";
import type { EffectiveCheck } from "@/lib/monitoring/checks";
import type {
  AssessmentOutcome,
  AssessmentRunMeta,
} from "@/lib/monitoring/assess";
import type {
  AssessmentObservation,
  AssessmentTarget,
  ConcernStatus,
  MonitorCategory,
  MonitorDepth,
  ResolvedTarget,
  RunCoverage,
  RunStatus,
  RunTrigger,
  Severity,
  TargetKind,
  WorkloadKind,
  WorkloadTechnology,
  CatalogueSource,
} from "@/lib/monitoring/types";

/**
 * All monitoring-module data access. Separate from the user-scoped
 * `queries.ts` (which stays pristine) and from `admin-queries.ts` (analytics),
 * following the precedent in docs/DECISIONS.md.
 *
 * Clusters belong to an org, and everything else (workloads, jobs, runs,
 * concerns, observations) hangs off a cluster. Lists take an `orgId`; by-id reads
 * do not, because every caller first proves the id is the org's with
 * `monitoringOrgOf` — the one gate, instead of an org join in ~60 queries. The
 * check catalogue and playbooks are still global (platform-admin only) until
 * they become per-org templates.
 */

// ---- Org ownership ----

/** Something a monitoring route is addressed by. */
export type MonitoringRef =
  | { cluster: string }
  | { job: string }
  | { run: string }
  | { concern: string };

/**
 * The org that owns a monitoring entity, found by walking up to its cluster —
 * null when it does not exist (or the id is not even a uuid, which would be a
 * Postgres cast error rather than "absent").
 */
export async function monitoringOrgOf(ref: MonitoringRef): Promise<string | null> {
  const id = Object.values(ref)[0];
  if (!isUuid(id)) return null;
  const owner = (jobId: SQL) =>
    db
      .select({ orgId: monitoringClusters.orgId })
      .from(monitoringJobs)
      .innerJoin(monitoringClusters, eq(monitoringClusters.id, monitoringJobs.clusterId))
      .where(eq(monitoringJobs.id, jobId));
  let rows: { orgId: string }[];
  if ("cluster" in ref) {
    rows = await db
      .select({ orgId: monitoringClusters.orgId })
      .from(monitoringClusters)
      .where(eq(monitoringClusters.id, id));
  } else if ("job" in ref) {
    rows = await owner(sql`${id}::uuid`);
  } else if ("run" in ref) {
    rows = await owner(
      sql`(select ${monitoringRuns.jobId} from ${monitoringRuns} where ${monitoringRuns.id} = ${id})`,
    );
  } else {
    rows = await owner(
      sql`(select ${monitoringConcerns.jobId} from ${monitoringConcerns} where ${monitoringConcerns.id} = ${id})`,
    );
  }
  return rows[0]?.orgId ?? null;
}

// ---- Check catalogue (the live rubric) ----

/**
 * Whose catalogue a read or write addresses: an org (its effective rubric, edits
 * fork the template) or `null` — the templates themselves, platform admins only.
 */
export type CatalogueOwner = string | null;

/** The ids of every job on one org's clusters — how concerns and readings find their org. */
const jobsOfOrg = (orgId: string) =>
  db
    .select({ id: monitoringJobs.id })
    .from(monitoringJobs)
    .innerJoin(monitoringClusters, eq(monitoringClusters.id, monitoringJobs.clusterId))
    .where(eq(monitoringClusters.orgId, orgId));

/** What the org sees, and the template behind it (null for an org's own check). */
const templatesAndOrg = (
  column:
    | typeof monitoringChecks.orgId
    | typeof monitoringPlaybooks.orgId
    | typeof monitoringWorkloadTypes.orgId,
  owner: CatalogueOwner,
) => (owner === null ? isNull(column) : or(isNull(column), eq(column, owner)));

export type CheckRow = typeof monitoringChecks.$inferSelect;

export interface CatalogueCheck extends CheckRow {
  source: CatalogueSource;
  /** The template moved on since this org's fork was made or last reviewed. */
  updateAvailable: boolean;
  /** The template's current version, when there is one. */
  templateVersion: number | null;
  /** The template behind an org's fork — what the panel diffs against. */
  template: CheckRow | null;
}

/**
 * Overlay an org's rows on the templates, key by key: the org's row wins where
 * one exists. One function for checks and playbooks, so "effective" means the
 * same thing for both.
 */
export function overlay<
  R extends { orgId: string | null; version: number; basedOnVersion: number | null },
>(
  rows: R[],
  keyOf: (row: R) => string,
): (R & { source: CatalogueSource; updateAvailable: boolean; templateVersion: number | null; template: R | null })[] {
  const templates = new Map<string, R>();
  const own = new Map<string, R>();
  for (const row of rows) (row.orgId === null ? templates : own).set(keyOf(row), row);
  const keys = new Set([...templates.keys(), ...own.keys()]);
  return [...keys].map((key) => {
    const template = templates.get(key) ?? null;
    const mine = own.get(key);
    const row = mine ?? template!;
    return {
      ...row,
      source: !mine ? "template" : template ? "override" : "custom",
      updateAvailable: Boolean(
        mine && template && template.version > (mine.basedOnVersion ?? 0),
      ),
      templateVersion: template?.version ?? null,
      template: mine ? template : null,
    };
  });
}

/** The effective catalogue for an org (or the templates alone, for `null`). */
export async function listCatalogueChecks(
  owner: CatalogueOwner,
): Promise<CatalogueCheck[]> {
  const rows = await db
    .select()
    .from(monitoringChecks)
    .where(templatesAndOrg(monitoringChecks.orgId, owner))
    .orderBy(asc(monitoringChecks.category), asc(monitoringChecks.id));
  return overlay(rows, (r) => r.id).sort((a, b) =>
      a.category === b.category
        ? a.id.localeCompare(b.id)
        : a.category.localeCompare(b.category),
    );
}

/** One effective check, plus the template behind an org's fork (for the diff). */
export async function getCatalogueCheck(
  owner: CatalogueOwner,
  id: string,
): Promise<CatalogueCheck | null> {
  const rows = await db
    .select()
    .from(monitoringChecks)
    .where(
      and(eq(monitoringChecks.id, id), templatesAndOrg(monitoringChecks.orgId, owner)),
    );
  return overlay(rows, (r) => r.id)[0] ?? null;
}

/**
 * Seed the built-in TEMPLATES. Insert-if-missing — a platform admin's retune of a
 * template must survive every restart. The `(org_id, id)` unique constraint is
 * NULLS NOT DISTINCT, so a template that already exists is a conflict.
 */
export async function seedBuiltinChecks(
  rows: Omit<
    CheckRow,
    | "uid"
    | "orgId"
    | "basedOnVersion"
    | "createdBy"
    | "createdAt"
    | "updatedAt"
    | "version"
    | "enabled"
  >[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db
    .insert(monitoringChecks)
    .values(rows.map((r) => ({ ...r, builtin: true })))
    .onConflictDoNothing()
    .returning({ id: monitoringChecks.id });
  return inserted.length;
}

export type CheckFields = Omit<
  CheckRow,
  "uid" | "orgId" | "id" | "basedOnVersion" | "builtin" | "createdBy" | "createdAt" | "updatedAt"
>;

/** A new check: a template (owner `null`) or an org's own check. */
export async function createCheck(
  owner: CatalogueOwner,
  input: Omit<CheckFields, "version"> & { id: string },
  createdBy: string,
): Promise<CheckRow> {
  const [row] = await db
    .insert(monitoringChecks)
    .values({ ...input, orgId: owner, builtin: false, createdBy })
    .returning();
  return row;
}

/**
 * Write a check as `owner` sees it. A template edit (owner `null`) or an edit to
 * an org's existing row updates in place; an org editing a template it has not
 * forked yet gets its own copy, remembering the template version it started from.
 */
export async function saveCheck(
  owner: CatalogueOwner,
  current: CatalogueCheck,
  fields: Partial<CheckFields>,
  actorId: string,
): Promise<CheckRow> {
  if (owner !== null && current.orgId === null) {
    const [row] = await db
      .insert(monitoringChecks)
      .values({
        id: current.id,
        builtin: current.builtin,
        category: current.category,
        title: current.title,
        question: current.question,
        evidence: current.evidence,
        reference: current.reference,
        baseSeverity: current.baseSeverity,
        appliesTo: current.appliesTo,
        appliesToTechnologies: current.appliesToTechnologies,
        excludesTechnologies: current.excludesTechnologies,
        requires: current.requires,
        resolveAfterAbsentRuns: current.resolveAfterAbsentRuns,
        enabled: current.enabled,
        version: current.version,
        ...fields,
        orgId: owner,
        basedOnVersion: current.version,
        createdBy: actorId,
      })
      .returning();
    return row;
  }
  const [row] = await db
    .update(monitoringChecks)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(monitoringChecks.uid, current.uid))
    .returning();
  return row;
}

/**
 * Drop an org's own row for a key: for a fork that is "reset to template", for an
 * org's own check it is a delete. Templates are never deleted through here.
 */
export async function deleteOrgCheck(orgId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringChecks)
    .where(and(eq(monitoringChecks.orgId, orgId), eq(monitoringChecks.id, id)))
    .returning({ uid: monitoringChecks.uid });
  return rows.length > 0;
}

/** Delete a custom TEMPLATE (built-in templates are disable-only). */
export async function deleteTemplateCheck(id: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringChecks)
    .where(
      and(isNull(monitoringChecks.orgId), eq(monitoringChecks.id, id), eq(monitoringChecks.builtin, false)),
    )
    .returning({ uid: monitoringChecks.uid });
  return rows.length > 0;
}

/** "I have seen the template's change": the fork stops being flagged as behind. */
export async function markCheckReviewed(
  orgId: string,
  id: string,
  templateVersion: number,
): Promise<void> {
  await db
    .update(monitoringChecks)
    .set({ basedOnVersion: templateVersion })
    .where(and(eq(monitoringChecks.orgId, orgId), eq(monitoringChecks.id, id)));
}

/** Concerns raised by jobs on this org's clusters (or on every org's, for `null`). */
function concernsOf(owner: CatalogueOwner) {
  return owner === null ? undefined : inArray(monitoringConcerns.jobId, jobsOfOrg(owner));
}

/** Concern history referencing a check — what makes deletion unsafe. */
export async function countConcernsForCheck(
  checkId: string,
  owner: CatalogueOwner,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(monitoringConcerns)
    .where(and(eq(monitoringConcerns.checkId, checkId), concernsOf(owner)));
  return row?.n ?? 0;
}

/**
 * Close concerns for a check that has just stopped being evaluated. Without
 * this they would sit open forever: reconciliation deliberately never touches a
 * concern whose check did not run, so nothing else can ever close them.
 *
 * Scoped to where the check stopped: one job (a per-job override), one org (its
 * copy was disabled), or — a template disabled — every org still inheriting it,
 * which excludes orgs whose own copy keeps it running.
 */
export async function autoResolveConcernsForDisabledCheck(
  checkId: string,
  scope: { jobId: string } | { orgId: string } | { template: true },
): Promise<number> {
  const where =
    "jobId" in scope
      ? eq(monitoringConcerns.jobId, scope.jobId)
      : "orgId" in scope
        ? concernsOf(scope.orgId)
        : notInArray(
            monitoringConcerns.jobId,
            db
              .select({ id: monitoringJobs.id })
              .from(monitoringJobs)
              .innerJoin(monitoringClusters, eq(monitoringClusters.id, monitoringJobs.clusterId))
              .innerJoin(
                monitoringChecks,
                and(
                  eq(monitoringChecks.orgId, monitoringClusters.orgId),
                  eq(monitoringChecks.id, checkId),
                ),
              ),
          );
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
        where,
      ),
    )
    .returning({ id: monitoringConcerns.id });
  return rows.length;
}

// ---- Per-job catalogue overrides ----

// ---- Playbooks (the live methods) ----

export type PlaybookRow = typeof monitoringPlaybooks.$inferSelect;

export type CataloguePlaybook = PlaybookRow & {
  source: CatalogueSource;
  updateAvailable: boolean;
  templateVersion: number | null;
  /** The template behind an org's fork — what "update available" compares to. */
  template: PlaybookRow | null;
};

/** The effective methods for an org (or the templates alone, for `null`). */
export async function listCataloguePlaybooks(
  owner: CatalogueOwner,
): Promise<CataloguePlaybook[]> {
  const rows = await db
    .select()
    .from(monitoringPlaybooks)
    .where(templatesAndOrg(monitoringPlaybooks.orgId, owner));
  return overlay(rows, (r) => r.technology).sort((a, b) =>
    a.technology.localeCompare(b.technology),
  );
}

export async function getCataloguePlaybook(
  owner: CatalogueOwner,
  technology: WorkloadTechnology,
): Promise<CataloguePlaybook | null> {
  const rows = await db
    .select()
    .from(monitoringPlaybooks)
    .where(
      and(
        eq(monitoringPlaybooks.technology, technology),
        templatesAndOrg(monitoringPlaybooks.orgId, owner),
      ),
    );
  return overlay(rows, (r) => r.technology)[0] ?? null;
}

/**
 * Seed the shipped methods as TEMPLATES: insert what is missing, and refresh a
 * template nobody has edited — bumping its version only when the text actually
 * changed, so every org's fork is told about a real change and not about a boot.
 *
 * Deliberately unlike `seedBuiltinChecks`, which is insert-only. A check has an
 * identity a run's history hangs off, so overwriting one silently rewrites what a
 * past finding meant; a playbook is only instructions for the next run.
 * `edited_by IS NULL` is the rule: a platform admin's edit always wins, a pristine
 * template always tracks git. Org forks are never touched.
 */
export async function seedPlaybooks(
  rows: Pick<
    PlaybookRow,
    "technology" | "framing" | "dataSources" | "method" | "observations"
  >[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const changed = sql`(${monitoringPlaybooks.framing}, ${monitoringPlaybooks.dataSources}, ${monitoringPlaybooks.method}, ${monitoringPlaybooks.observations})
    is distinct from (excluded.framing, excluded.data_sources, excluded.method, excluded.observations)`;
  const written = await db
    .insert(monitoringPlaybooks)
    .values(rows)
    .onConflictDoUpdate({
      target: [monitoringPlaybooks.orgId, monitoringPlaybooks.technology],
      set: {
        framing: sql`excluded.framing`,
        dataSources: sql`excluded.data_sources`,
        method: sql`excluded.method`,
        observations: sql`excluded.observations`,
        version: sql`${monitoringPlaybooks.version} + 1`,
        updatedAt: new Date(),
      },
      setWhere: and(isNull(monitoringPlaybooks.editedBy), changed),
    })
    .returning({ technology: monitoringPlaybooks.technology });
  return written.length;
}

export type PlaybookFields = Pick<
  PlaybookRow,
  "framing" | "dataSources" | "method" | "observations"
>;

/**
 * Write a method as `owner` sees it. A template edit bumps its version (so org
 * forks hear about it); an org editing the template gets its own fork; and a type
 * that has no method yet (`current` null — a new workload type) gets its first.
 */
export async function savePlaybook(
  owner: CatalogueOwner,
  technology: WorkloadTechnology,
  current: CataloguePlaybook | null,
  fields: PlaybookFields,
  actorId: string,
): Promise<PlaybookRow> {
  if (!current) {
    const [row] = await db
      .insert(monitoringPlaybooks)
      .values({ ...fields, technology, orgId: owner, editedBy: actorId })
      .returning();
    return row;
  }
  if (owner !== null && current.orgId === null) {
    const [row] = await db
      .insert(monitoringPlaybooks)
      .values({
        ...fields,
        technology: current.technology,
        orgId: owner,
        editedBy: actorId,
        basedOnVersion: current.version,
      })
      .returning();
    return row;
  }
  const [row] = await db
    .update(monitoringPlaybooks)
    .set({
      ...fields,
      editedBy: actorId,
      ...(owner === null && { version: sql`${monitoringPlaybooks.version} + 1` }),
      updatedAt: new Date(),
    })
    .where(eq(monitoringPlaybooks.uid, current.uid))
    .returning();
  return row;
}

/** Reset to template: drop the org's fork. */
export async function deleteOrgPlaybook(
  orgId: string,
  technology: WorkloadTechnology,
): Promise<boolean> {
  const rows = await db
    .delete(monitoringPlaybooks)
    .where(
      and(eq(monitoringPlaybooks.orgId, orgId), eq(monitoringPlaybooks.technology, technology)),
    )
    .returning({ uid: monitoringPlaybooks.uid });
  return rows.length > 0;
}

export async function markPlaybookReviewed(
  orgId: string,
  technology: WorkloadTechnology,
  templateVersion: number,
): Promise<void> {
  await db
    .update(monitoringPlaybooks)
    .set({ basedOnVersion: templateVersion })
    .where(
      and(eq(monitoringPlaybooks.orgId, orgId), eq(monitoringPlaybooks.technology, technology)),
    );
}

// ---- Workload types (what a workload can be; decision 128) ----

export type WorkloadTypeRow = typeof monitoringWorkloadTypes.$inferSelect;

export type CatalogueWorkloadType = WorkloadTypeRow & {
  source: CatalogueSource;
  updateAvailable: boolean;
  templateVersion: number | null;
  template: WorkloadTypeRow | null;
};

/** The types `owner` sees — its own over the templates (or the templates alone). */
export async function listCatalogueWorkloadTypes(
  owner: CatalogueOwner,
): Promise<CatalogueWorkloadType[]> {
  const rows = await db
    .select()
    .from(monitoringWorkloadTypes)
    .where(templatesAndOrg(monitoringWorkloadTypes.orgId, owner));
  return overlay(rows, (r) => r.slug);
}

export async function getCatalogueWorkloadType(
  owner: CatalogueOwner,
  slug: string,
): Promise<CatalogueWorkloadType | null> {
  const rows = await db
    .select()
    .from(monitoringWorkloadTypes)
    .where(
      and(
        eq(monitoringWorkloadTypes.slug, slug),
        templatesAndOrg(monitoringWorkloadTypes.orgId, owner),
      ),
    );
  return overlay(rows, (r) => r.slug)[0] ?? null;
}

export type WorkloadTypeFields = Pick<
  WorkloadTypeRow,
  "label" | "priority" | "labelValues" | "patterns" | "enabled"
>;

/**
 * Seed the shipped types as TEMPLATES, playbook-style: insert what is missing,
 * refresh an un-edited template whose shipped definition changed (bumping its
 * version so forks hear of it), never touch an edited one or any org's row.
 */
export async function seedWorkloadTypes(
  rows: (Omit<WorkloadTypeFields, "enabled"> & { slug: string })[],
): Promise<void> {
  if (rows.length === 0) return;
  const t = monitoringWorkloadTypes;
  const changed = sql`(${t.label}, ${t.priority}, ${t.labelValues}, ${t.patterns})
    is distinct from (excluded.label, excluded.priority, excluded.label_values, excluded.patterns)`;
  await db
    .insert(t)
    .values(rows.map((r) => ({ ...r, builtin: true })))
    .onConflictDoUpdate({
      target: [t.orgId, t.slug],
      set: {
        label: sql`excluded.label`,
        priority: sql`excluded.priority`,
        labelValues: sql`excluded.label_values`,
        patterns: sql`excluded.patterns`,
        version: sql`${t.version} + 1`,
        updatedAt: new Date(),
      },
      setWhere: and(isNull(t.editedBy), changed),
    });
}

/** A new type: a template (owner `null`) or one only this org has. */
export async function createWorkloadType(
  owner: CatalogueOwner,
  input: WorkloadTypeFields & { slug: string },
  actorId: string,
): Promise<WorkloadTypeRow> {
  const [row] = await db
    .insert(monitoringWorkloadTypes)
    .values({ ...input, orgId: owner, editedBy: actorId })
    .returning();
  return row;
}

/**
 * Write a type as `owner` sees it: a template edit bumps its version; an org
 * editing a template gets its own copy (the same fork rule as checks/playbooks).
 */
export async function saveWorkloadType(
  owner: CatalogueOwner,
  current: CatalogueWorkloadType,
  fields: WorkloadTypeFields,
  actorId: string,
): Promise<WorkloadTypeRow> {
  if (owner !== null && current.orgId === null) {
    const [row] = await db
      .insert(monitoringWorkloadTypes)
      .values({
        ...fields,
        slug: current.slug,
        builtin: current.builtin,
        orgId: owner,
        editedBy: actorId,
        basedOnVersion: current.version,
      })
      .returning();
    return row;
  }
  const [row] = await db
    .update(monitoringWorkloadTypes)
    .set({
      ...fields,
      editedBy: actorId,
      ...(owner === null && { version: sql`${monitoringWorkloadTypes.version} + 1` }),
      updatedAt: new Date(),
    })
    .where(eq(monitoringWorkloadTypes.uid, current.uid))
    .returning();
  return row;
}

/** Drop the org's row for a slug: "reset" for a fork, delete for an org-only type. */
export async function deleteOrgWorkloadType(orgId: string, slug: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringWorkloadTypes)
    .where(and(eq(monitoringWorkloadTypes.orgId, orgId), eq(monitoringWorkloadTypes.slug, slug)))
    .returning({ uid: monitoringWorkloadTypes.uid });
  return rows.length > 0;
}

/** Delete a custom TEMPLATE type (shipped ones can only be disabled). */
export async function deleteTemplateWorkloadType(slug: string): Promise<boolean> {
  const rows = await db
    .delete(monitoringWorkloadTypes)
    .where(
      and(
        isNull(monitoringWorkloadTypes.orgId),
        eq(monitoringWorkloadTypes.slug, slug),
        eq(monitoringWorkloadTypes.builtin, false),
      ),
    )
    .returning({ uid: monitoringWorkloadTypes.uid });
  return rows.length > 0;
}

export async function markWorkloadTypeReviewed(
  orgId: string,
  slug: string,
  templateVersion: number,
): Promise<void> {
  await db
    .update(monitoringWorkloadTypes)
    .set({ basedOnVersion: templateVersion })
    .where(and(eq(monitoringWorkloadTypes.orgId, orgId), eq(monitoringWorkloadTypes.slug, slug)));
}

/** What would detection see: every workload of an org's clusters with its raw signals. */
export async function orgWorkloadSignals(orgId: string) {
  return db
    .select({
      clusterName: monitoringClusters.name,
      kind: monitoringWorkloads.kind,
      namespace: monitoringWorkloads.namespace,
      name: monitoringWorkloads.name,
      images: monitoringWorkloads.images,
      technology: monitoringWorkloads.technology,
      technologyOverride: monitoringWorkloads.technologyOverride,
    })
    .from(monitoringWorkloads)
    .innerJoin(monitoringClusters, eq(monitoringClusters.id, monitoringWorkloads.clusterId))
    .where(eq(monitoringClusters.orgId, orgId));
}

/**
 * How many readings each of these observation keys already has — what makes a key
 * un-renameable. Counted per KEY rather than per playbook on purpose: two engines
 * that measure the same thing deliberately share a key (17 do), so the series
 * belongs to the key, not to the method that happens to be asking.
 */
export async function observedKeyCounts(
  keys: readonly string[],
  owner: CatalogueOwner,
): Promise<Record<string, number>> {
  if (keys.length === 0) return {};
  // An org's readings lock its own keys; a template's keys are locked by
  // readings in ANY org, since every org that inherits it plots them.
  const inOrg =
    owner === null ? undefined : inArray(monitoringObservations.jobId, jobsOfOrg(owner));
  const rows = await db
    .select({ key: monitoringObservations.key, n: count() })
    .from(monitoringObservations)
    .where(and(inArray(monitoringObservations.key, [...keys]), inOrg))
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
export async function listClusters(orgId: string): Promise<ClusterListRow[]> {
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
    .where(eq(monitoringClusters.orgId, orgId))
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

/** A cluster row with its two credentials OPENED (they are sealed at rest). */
function openCluster<T extends { kubeconfig: string; holmesApiKey: string }>(row: T): T {
  return {
    ...row,
    kubeconfig: openSecret(row.kubeconfig),
    holmesApiKey: openSecret(row.holmesApiKey),
  };
}

/** Full row INCLUDING kubeconfig + Holmes key, opened — server-side use only. */
export async function getClusterSecrets(id: string) {
  const [row] = await db
    .select()
    .from(monitoringClusters)
    .where(eq(monitoringClusters.id, id))
    .limit(1);
  return row ? openCluster(row) : null;
}

export async function createCluster(input: {
  orgId: string;
  name: string;
  kubeconfig: string;
  holmesUrl: string;
  holmesApiKey: string;
  createdBy: string;
}): Promise<ClusterSummary> {
  const [row] = await db
    .insert(monitoringClusters)
    .values({
      ...input,
      kubeconfig: sealSecret(input.kubeconfig),
      holmesApiKey: sealSecret(input.holmesApiKey),
      lastValidatedAt: new Date(),
    })
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
    .set({
      ...fields,
      ...(fields.kubeconfig !== undefined && { kubeconfig: sealSecret(fields.kubeconfig) }),
      ...(fields.holmesApiKey !== undefined && {
        holmesApiKey: sealSecret(fields.holmesApiKey),
      }),
      updatedAt: new Date(),
    })
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
      // Whether a deep run has a method for it: a playbook for its effective
      // technology in the cluster's org — its own copy or a template. Plain,
      // fully-qualified SQL for the reason given on `listClusters`.
      profiled: sql<boolean>`exists (
        select 1 from monitoring_playbooks p
        join monitoring_clusters c on c.id = monitoring_workloads.cluster_id
        where p.technology = coalesce(monitoring_workloads.technology_override, monitoring_workloads.technology)
          and (p.org_id is null or p.org_id = c.org_id))`,
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
    return { ...row, technology, technologyDetected: row.technology };
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

/** The org's jobs (or one cluster's), grouped by cluster — feeds the tree sidebar. */
export async function listJobs(
  orgId: string,
  clusterId?: string,
): Promise<JobListRow[]> {
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
    .innerJoin(
      monitoringClusters,
      eq(monitoringClusters.id, monitoringJobs.clusterId),
    )
    .where(
      and(
        eq(monitoringClusters.orgId, orgId),
        clusterId ? eq(monitoringJobs.clusterId, clusterId) : undefined,
      ),
    )
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
  return {
    ...row,
    cluster: openCluster(row.cluster),
    targets: await getResolvedJobTargets(jobId),
  };
}

// ---- Runs / queue ----

export interface RunRow {
  id: string;
  jobId: string;
  status: RunStatus;
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
 * Stamped at claim time so a run that fails before Holmes answers still says which
 * model it asked for; completion overwrites it with the model that actually ran.
 */
const JOB_MODEL = sql`(select ${monitoringJobs.model} from ${monitoringJobs} where ${monitoringJobs.id} = ${monitoringRuns.jobId})`;

/**
 * Atomically claim up to `limit` queued runs. `FOR UPDATE SKIP LOCKED` is what
 * makes several worker replicas safe: a row can only be claimed once. The first
 * heartbeat is stamped with the claim, so a worker that dies before its heartbeat
 * timer ever fires is still reapable.
 */
export async function claimQueuedRuns(
  limit: number,
): Promise<{ id: string; jobId: string }[]> {
  const rows = await db.execute(sql`
    update ${monitoringRuns} set
      status = 'running',
      claimed_at = now(),
      started_at = now(),
      heartbeat_at = now(),
      attempt = ${monitoringRuns.attempt} + 1,
      model = ${JOB_MODEL}
    where id in (
      -- Fair across orgs (decision 130). Rank = the org's running runs plus the
      -- run's place in its org's queue; ties go to the org served LEAST recently.
      -- The tie-break is what makes it fair here: this lane runs one at a time, so
      -- at claim time nobody has anything running and rank alone would collapse
      -- back into first-in-first-out. Ranked unlocked; only the pick is locked.
      with org_runs as (
        select r.id, r.status, r.created_at, r.claimed_at, c.org_id
        from monitoring_runs r
        join monitoring_jobs j on j.id = r.job_id
        join monitoring_clusters c on c.id = j.cluster_id
        where r.status in ('queued', 'running')
           or r.claimed_at > now() - interval '1 day'
      ),
      running as (
        select org_id, count(*) as n from org_runs where status = 'running' group by org_id
      ),
      served as (
        select org_id, max(claimed_at) as last from org_runs group by org_id
      ),
      ranked as (
        select q.id, q.created_at, s.last,
          coalesce(n.n, 0) + row_number() over (partition by q.org_id order by q.created_at) as fair
        from org_runs q
        left join running n on n.org_id = q.org_id
        left join served s on s.org_id = q.org_id
        where q.status = 'queued'
      )
      select m.id from ${monitoringRuns} m
      join ranked k on k.id = m.id
      where m.status = 'queued'
      order by k.fair, k.last nulls first, k.created_at
      limit ${limit}
      for update of m skip locked
    )
    returning id, job_id
  `);
  return (rows as unknown as { id: string; job_id: string }[]).map((r) => ({
    id: r.id,
    jobId: r.job_id,
  }));
}

/**
 * End a run without findings. Guarded on `running` so it can never overwrite a run
 * that another finalizer (the reaper, a cancel) already closed.
 */
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
    prompts: { target: string; prompt: string }[];
  }> = {},
  status: "failed" | "cancelled" = "failed",
) {
  await db
    .update(monitoringRuns)
    .set({
      status,
      error: error.slice(0, 4000),
      finishedAt: new Date(),
      ...extra,
    })
    .where(
      and(eq(monitoringRuns.id, id), eq(monitoringRuns.status, "running")),
    );
}

/**
 * Runs whose worker has gone quiet: `running`, and no heartbeat for `quietMs`.
 *
 * Judged by the heartbeat rather than by age, because age cannot tell a healthy
 * five-hour deep run from a dead one — the old per-depth thresholds had to wait
 * six hours to be sure. `claimed_at` covers rows claimed before heartbeats existed.
 */
export async function staleRunIds(quietMs: number): Promise<string[]> {
  const cutoff = new Date(Date.now() - quietMs);
  const rows = await db
    .select({ id: monitoringRuns.id })
    .from(monitoringRuns)
    .where(
      and(
        eq(monitoringRuns.status, "running"),
        // Two column comparisons rather than `lt(sql\`coalesce(…)\`, cutoff)`: a
        // Date compared to a raw expression skips the column's type mapper and
        // fails to serialize (docs/DECISIONS.md 53).
        or(
          lt(monitoringRuns.heartbeatAt, cutoff),
          and(
            isNull(monitoringRuns.heartbeatAt),
            lt(monitoringRuns.claimedAt, cutoff),
          ),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * The worker's liveness write, which doubles as its cancel check. Null when the
 * run is no longer `running` — someone else finalized it, and the worker must stop
 * without writing anything more.
 */
export async function heartbeatRun(
  runId: string,
): Promise<{ cancelRequested: boolean } | null> {
  const [row] = await db
    .update(monitoringRuns)
    .set({ heartbeatAt: new Date() })
    .where(
      and(eq(monitoringRuns.id, runId), eq(monitoringRuns.status, "running")),
    )
    .returning({ cancelRequestedAt: monitoringRuns.cancelRequestedAt });
  return row ? { cancelRequested: row.cancelRequestedAt !== null } : null;
}

/**
 * Cancel a run. A queued run has cost nothing yet and is closed on the spot; a
 * running one is only FLAGGED, because the worker holding its Holmes stream is the
 * one that has to abort it and reconcile what already finished.
 */
export async function requestCancel(
  runId: string,
  actorId: string,
): Promise<"cancelled" | "requested" | "inactive"> {
  const now = new Date();
  const [queued] = await db
    .update(monitoringRuns)
    .set({
      status: "cancelled",
      cancelRequestedAt: now,
      cancelledBy: actorId,
      finishedAt: now,
      error: "Cancelled before it started",
    })
    .where(
      and(eq(monitoringRuns.id, runId), eq(monitoringRuns.status, "queued")),
    )
    .returning({ id: monitoringRuns.id });
  if (queued) return "cancelled";
  // Idempotent: pressing Cancel again while the worker is still stopping is the
  // same request, and the first person to press it stays on record.
  const [running] = await db
    .update(monitoringRuns)
    .set({
      cancelRequestedAt: sql`coalesce(${monitoringRuns.cancelRequestedAt}, now())`,
      cancelledBy: sql`coalesce(${monitoringRuns.cancelledBy}, ${actorId}::uuid)`,
    })
    .where(
      and(eq(monitoringRuns.id, runId), eq(monitoringRuns.status, "running")),
    )
    .returning({ id: monitoringRuns.id });
  return running ? "requested" : "inactive";
}

/** A job's queued or running run, if any — what the job page renders a banner for. */
export async function activeRun(jobId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: monitoringRuns.id })
    .from(monitoringRuns)
    .where(
      and(
        eq(monitoringRuns.jobId, jobId),
        inArray(monitoringRuns.status, ACTIVE_RUN_STATUSES),
      ),
    )
    .orderBy(desc(monitoringRuns.createdAt))
    .limit(1);
  return row?.id ?? null;
}

export interface RunProgress {
  status: RunStatus;
  done: number;
  total: number;
  /** Label of the investigation in flight, when there is one. */
  current: string | null;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  cancelRequested: boolean;
  error: string | null;
  /** When this reading was taken — the clock a client-side elapsed timer starts from. */
  asOf: string;
}

/**
 * What the progress banner polls. Counts come from the saved per-target rows, so
 * the banner and the reconciliation read the same truth.
 */
export async function runProgress(runId: string): Promise<RunProgress | null> {
  const [[run], targets] = await Promise.all([
    db
      .select({
        status: monitoringRuns.status,
        createdAt: monitoringRuns.createdAt,
        startedAt: monitoringRuns.startedAt,
        heartbeatAt: monitoringRuns.heartbeatAt,
        cancelRequestedAt: monitoringRuns.cancelRequestedAt,
        error: monitoringRuns.error,
      })
      .from(monitoringRuns)
      .where(eq(monitoringRuns.id, runId))
      .limit(1),
    db
      .select({
        status: monitoringRunTargets.status,
        label: monitoringRunTargets.label,
      })
      .from(monitoringRunTargets)
      .where(eq(monitoringRunTargets.runId, runId))
      .orderBy(asc(monitoringRunTargets.position)),
  ]);
  if (!run) return null;
  return {
    status: run.status,
    done: targets.filter((t) => t.status !== "pending" && t.status !== "running")
      .length,
    total: targets.length,
    current: targets.find((t) => t.status === "running")?.label ?? null,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
    cancelRequested: run.cancelRequestedAt !== null,
    error: run.error,
    asOf: new Date().toISOString(),
  };
}

// ---- Run targets (per-investigation results, saved as they finish) ----

/**
 * Snapshot what the run will be graded against and lay out its investigations,
 * in one transaction, before the first Holmes call.
 */
export async function prepareRun(
  runId: string,
  input: {
    rubricSnapshot: EffectiveCheck[];
    expectedObservations: ExpectedObservations[] | null;
    targets: { label: string; targets: ResolvedTarget[] }[];
  },
): Promise<{ id: string; position: number }[]> {
  return db.transaction(async (tx) => {
    await tx
      .update(monitoringRuns)
      .set({
        rubricSnapshot: input.rubricSnapshot,
        expectedObservations: input.expectedObservations,
      })
      .where(eq(monitoringRuns.id, runId));
    return tx
      .insert(monitoringRunTargets)
      .values(
        input.targets.map((t, position) => ({ runId, position, ...t })),
      )
      .returning({
        id: monitoringRunTargets.id,
        position: monitoringRunTargets.position,
      });
  });
}

export async function startRunTarget(id: string): Promise<void> {
  await db
    .update(monitoringRunTargets)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(monitoringRunTargets.id, id));
}

export async function finishRunTarget(
  id: string,
  result:
    | { status: "completed"; outcome: AssessmentOutcome }
    | { status: "failed" | "skipped"; error: string; failedMeta?: AssessmentRunMeta },
): Promise<void> {
  await db
    .update(monitoringRunTargets)
    .set({
      ...result,
      ...("error" in result ? { error: result.error.slice(0, 4000) } : {}),
      finishedAt: new Date(),
    })
    .where(eq(monitoringRunTargets.id, id));
}

/** Everything a finalizer needs, read back from the database rather than memory. */
export async function runForFinalize(runId: string) {
  const [[run], targets] = await Promise.all([
    db
      .select({
        jobId: monitoringRuns.jobId,
        clusterId: monitoringJobs.clusterId,
        category: monitoringJobs.type,
        status: monitoringRuns.status,
        rubricSnapshot: monitoringRuns.rubricSnapshot,
      })
      .from(monitoringRuns)
      .innerJoin(monitoringJobs, eq(monitoringJobs.id, monitoringRuns.jobId))
      .where(eq(monitoringRuns.id, runId))
      .limit(1),
    db
      .select({
        label: monitoringRunTargets.label,
        status: monitoringRunTargets.status,
        outcome: monitoringRunTargets.outcome,
        failedMeta: monitoringRunTargets.failedMeta,
        error: monitoringRunTargets.error,
      })
      .from(monitoringRunTargets)
      .where(eq(monitoringRunTargets.runId, runId))
      .orderBy(asc(monitoringRunTargets.position)),
  ]);
  return run ? { ...run, targets } : null;
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
  return (await activeRun(jobId)) !== null;
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
 *
 * `final` closes an INTERRUPTED run (cancelled, worker shut down, worker died)
 * that still has finished investigations to keep: its concerns are reconciled
 * from what completed, and the run records why it stopped short.
 *
 * The closing update only matches a `running` row, and anything else rolls the
 * whole transaction back — so when the worker and the reaper race to finalize the
 * same run, the loser changes nothing.
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
    prompts: { target: string; prompt: string }[];
    model: string;
    costUsd: number | null;
    totalTokens: number | null;
    durationMs: number;
    toolCallsTotal: number;
    toolCallsFailed: number;
  },
  final?: { status: "failed" | "cancelled"; error: string },
): Promise<ReconcileResult | null> {
  const { observations, ...runColumns } = runFields;
  try {
    return await db.transaction(async (tx) => {
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

      const closed = await tx
        .update(monitoringRuns)
        .set({
          status: final?.status ?? "completed",
          error: final?.error.slice(0, 4000) ?? null,
          finishedAt: now,
          findingsNew: newCount,
          findingsResolved: plan.autoResolveIds.length,
          findingsOpen: openCount,
          ...runColumns,
        })
        .where(
          and(eq(monitoringRuns.id, runId), eq(monitoringRuns.status, "running")),
        )
        .returning({ id: monitoringRuns.id });
      // Throws, which is what rolls the concern updates back.
      if (closed.length === 0) tx.rollback();

      return {
        newCount,
        resolvedCount: plan.autoResolveIds.length,
        openCount,
      };
    });
  } catch (err) {
    if (err instanceof TransactionRollbackError) return null;
    throw err;
  }
}
