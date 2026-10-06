import "server-only";
import {
  getCataloguePlaybook,
  listCataloguePlaybooks,
  observedKeyCounts,
  seedPlaybooks,
  type CatalogueOwner,
  type CataloguePlaybook,
  type PlaybookRow,
} from "@/lib/db/monitoring-queries";
import {
  type Playbook,
  type PlaybookSummary,
  type PlaybookView,
} from "./playbook";
import { PROFILES } from "./profiles";
import type { WorkloadTechnology } from "./types";
import { liveChecks } from "./checks";
import { technologyLabels } from "./workload-types-live";

/**
 * Reads the LIVE methods — the `monitoring_playbooks` table — the way
 * `checks.ts` reads the live rubric. Everything that assesses goes through here;
 * nothing outside this module should reach for `PROFILES[].playbook`, which is
 * only the seed.
 *
 * The split is the same one decision 54 made for the rubric, and it buys the same
 * thing: the text stays in git for review, while an operator can correct a method
 * against a cluster that turned out not to match it without waiting for a deploy.
 * Each read names its owner, as with checks: an org gets its own forks over the
 * templates, `null` the templates alone. `seedPlaybooks` keeps every un-edited
 * TEMPLATE tracking git; an org's fork is the org's and is never rewritten — it is
 * told when its template moved on instead (decision 126).
 */

/** The methods this release ships, keyed by technology. */
const SHIPPED: ReadonlyMap<WorkloadTechnology, Playbook> = new Map(
  PROFILES.map((profile) => [profile.technology, profile.playbook]),
);

/**
 * The checks each method exists to answer — editor context, not prompt input. Read
 * from the owner's LIVE catalogue (checks scoped to the technology), so a new
 * workload type's own checks count as soon as they exist.
 */
async function checkIdsByTechnology(
  owner: CatalogueOwner,
): Promise<Map<WorkloadTechnology, string[]>> {
  const byTechnology = new Map<WorkloadTechnology, string[]>();
  for (const check of await liveChecks(owner)) {
    for (const technology of check.appliesToTechnologies) {
      byTechnology.set(technology, [...(byTechnology.get(technology) ?? []), check.id]);
    }
  }
  return byTechnology;
}

/** The starting point for a type's FIRST method — nothing to fork, nothing to keep. */
export const EMPTY_METHOD = (technology: WorkloadTechnology): Playbook => ({
  technology,
  framing: "",
  dataSources: [],
  method: [],
  observations: [],
});

/**
 * Idempotently seed the shipped methods, once per process — same shape as
 * `ensureBuiltinChecks`, including un-memoizing on failure so a transient DB
 * error cannot leave the table empty until the next restart.
 */
let seeded: Promise<void> | null = null;

export function ensurePlaybooks(): Promise<void> {
  seeded ??= seedPlaybooks(
    [...SHIPPED.values()].map((playbook) => ({
      technology: playbook.technology,
      framing: playbook.framing,
      dataSources: [...playbook.dataSources],
      method: [...playbook.method],
      observations: [...playbook.observations],
    })),
  ).then(() => undefined);
  seeded.catch(() => {
    seeded = null;
  });
  return seeded;
}

export function toPlaybook(row: PlaybookRow): Playbook {
  return {
    technology: row.technology,
    framing: row.framing,
    dataSources: row.dataSources,
    method: row.method,
    observations: row.observations,
  };
}

/** Every method `owner` sees, seeding the shipped ones on first read. */
export async function livePlaybooks(owner: CatalogueOwner): Promise<CataloguePlaybook[]> {
  await ensurePlaybooks();
  return listCataloguePlaybooks(owner);
}

/**
 * The shelf's shape — see PlaybookSummary for why it is separate. Every type the
 * owner knows gets a tile, so a type with no method yet shows up as one to write
 * rather than being invisible.
 */
export async function playbookSummaries(owner: CatalogueOwner): Promise<PlaybookSummary[]> {
  const [rows, checkIds, types] = await Promise.all([
    livePlaybooks(owner),
    checkIdsByTechnology(owner),
    technologyLabels(owner),
  ]);
  const summaries: PlaybookSummary[] = rows.map((row) => ({
    technology: row.technology,
    checkCount: (checkIds.get(row.technology) ?? []).length,
    observationCount: row.observations.length,
    editedAt: row.editedBy ? row.updatedAt.toISOString() : null,
    source: row.source,
    updateAvailable: row.updateAvailable,
    missing: false,
  }));
  const covered = new Set(rows.map((r) => r.technology));
  for (const type of types) {
    if (covered.has(type.slug)) continue;
    summaries.push({
      technology: type.slug,
      checkCount: (checkIds.get(type.slug) ?? []).length,
      observationCount: 0,
      editedAt: null,
      source: "custom",
      updateAvailable: false,
      missing: true,
    });
  }
  return summaries;
}

/** One method as `owner` sees it — the catalogue row the routes edit. */
export async function cataloguePlaybook(
  owner: CatalogueOwner,
  technology: WorkloadTechnology,
): Promise<CataloguePlaybook | null> {
  await ensurePlaybooks();
  return getCataloguePlaybook(owner, technology);
}

/** One method in full, for the panel that opens it. */
export async function playbookView(
  owner: CatalogueOwner,
  technology: WorkloadTechnology,
): Promise<PlaybookView | null> {
  const [row, checkIds] = await Promise.all([
    cataloguePlaybook(owner, technology),
    checkIdsByTechnology(owner),
  ]);
  // A known type with no method yet opens as an empty one to write.
  if (!row)
    return {
      ...EMPTY_METHOD(technology),
      checkIds: checkIds.get(technology) ?? [],
      readings: {},
      editedAt: null,
      source: "custom",
      updateAvailable: false,
      template: null,
    };
  const counts = await observedKeyCounts(
    row.observations.map((o) => o.key),
    owner,
  );
  return {
    ...toPlaybook(row),
    checkIds: checkIds.get(row.technology) ?? [],
    readings: Object.fromEntries(
      row.observations
        .map((o) => [o.key, counts[o.key] ?? 0] as const)
        .filter(([, n]) => n > 0),
    ),
    editedAt: row.editedBy ? row.updatedAt.toISOString() : null,
    source: row.source,
    updateAvailable: row.updateAvailable,
    template: row.template ? toPlaybook(row.template) : null,
  };
}

/**
 * The methods a run will actually use, resolved ONCE per run.
 *
 * Deliberately a resolver rather than a per-target lookup: a deep run assesses
 * one workload per call and would otherwise query the table once per workload to
 * get N views of the same six rows — and, worse, could pick up an edit made
 * halfway through its own run, so two workloads in one run would be measured by
 * two different methods.
 */
export interface RunPlaybooks {
  for(technology: WorkloadTechnology | null | undefined): Playbook | undefined;
}

/** A posture run has no method at all — this keeps the run path free of nulls. */
export const NO_PLAYBOOKS: RunPlaybooks = {
  for: () => undefined,
};

/** The methods the org owning the run's cluster actually uses. */
export async function playbookResolver(orgId: string): Promise<RunPlaybooks> {
  const byTechnology = new Map(
    (await livePlaybooks(orgId)).map((row) => [row.technology, toPlaybook(row)]),
  );
  return {
    for: (technology) =>
      technology ? byTechnology.get(technology) : undefined,
  };
}
