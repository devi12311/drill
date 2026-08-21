import "server-only";
import {
  getPlaybookRow,
  listPlaybookRows,
  observedKeyCounts,
  seedPlaybooks,
  type PlaybookRow,
} from "@/lib/db/monitoring-queries";
import {
  type Playbook,
  type PlaybookSummary,
  type PlaybookView,
} from "./playbook";
import { PROFILES } from "./profiles";
import type { WorkloadTechnology } from "./types";

/**
 * Reads the LIVE methods — the `monitoring_playbooks` table — the way
 * `checks.ts` reads the live rubric. Everything that assesses goes through here;
 * nothing outside this module should reach for `PROFILES[].playbook`, which is
 * only the seed.
 *
 * The split is the same one decision 54 made for the rubric, and it buys the same
 * thing: the text stays in git for review, while an operator can correct a method
 * against a cluster that turned out not to match it without waiting for a deploy.
 * Unlike the rubric there is no version and no adopt-the-shipped-text flow: an
 * edit simply wins, and `seedPlaybooks` keeps every un-edited row tracking git.
 */

/** The methods this release ships, keyed by technology. */
const SHIPPED: ReadonlyMap<WorkloadTechnology, Playbook> = new Map(
  PROFILES.map((profile) => [profile.technology, profile.playbook]),
);

/** The checks each method exists to answer — editor context, not prompt input. */
const CHECK_IDS: ReadonlyMap<WorkloadTechnology, string[]> = new Map(
  PROFILES.map((profile) => [
    profile.technology,
    profile.checks.map((check) => check.id),
  ]),
);

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

/** Every live method, seeding the shipped ones on first read. */
export async function livePlaybookRows(): Promise<PlaybookRow[]> {
  await ensurePlaybooks();
  return listPlaybookRows();
}

/** The shelf's shape — see PlaybookSummary for why it is separate. */
export async function playbookSummaries(): Promise<PlaybookSummary[]> {
  return (await livePlaybookRows()).map((row) => ({
    technology: row.technology,
    checkCount: (CHECK_IDS.get(row.technology) ?? []).length,
    observationCount: row.observations.length,
    editedAt: row.editedBy ? row.updatedAt.toISOString() : null,
  }));
}

/** One method in full, for the panel that opens it. */
export async function playbookView(
  technology: WorkloadTechnology,
): Promise<PlaybookView | null> {
  await ensurePlaybooks();
  const row = await getPlaybookRow(technology);
  if (!row) return null;
  const counts = await observedKeyCounts(
    row.observations.map((o) => o.key),
  );
  return {
    ...toPlaybook(row),
    checkIds: CHECK_IDS.get(row.technology) ?? [],
    readings: Object.fromEntries(
      row.observations
        .map((o) => [o.key, counts[o.key] ?? 0] as const)
        .filter(([, n]) => n > 0),
    ),
    editedAt: row.editedBy ? row.updatedAt.toISOString() : null,
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

export async function playbookResolver(): Promise<RunPlaybooks> {
  const byTechnology = new Map(
    (await livePlaybookRows()).map((row) => [row.technology, toPlaybook(row)]),
  );
  return {
    for: (technology) =>
      technology ? byTechnology.get(technology) : undefined,
  };
}
