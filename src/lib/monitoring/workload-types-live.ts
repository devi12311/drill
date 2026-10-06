import "server-only";
import {
  listCatalogueWorkloadTypes,
  seedWorkloadTypes,
  type CatalogueOwner,
  type CatalogueWorkloadType,
} from "@/lib/db/monitoring-queries";
import { PROFILES } from "./profiles";
import {
  byPriority,
  CLUSTER_TECHNOLOGY,
  CLUSTER_TECHNOLOGY_LABEL,
  type DetectableType,
  type WorkloadTypeView,
} from "./workload-types";

/**
 * Reads the LIVE workload types — the `monitoring_workload_types` table — the way
 * checks.ts reads the rubric and playbooks.ts the methods. The shipped types in
 * `PROFILES[].type` are only the template seed (decision 128).
 */

let seeded: Promise<void> | null = null;

export function ensureWorkloadTypes(): Promise<void> {
  seeded ??= seedWorkloadTypes(
    PROFILES.flatMap((p) => (p.type ? [{ slug: p.technology, ...p.type }] : [])),
  );
  seeded.catch(() => {
    seeded = null;
  });
  return seeded;
}

/** Every type `owner` sees, disabled ones included. */
export async function liveWorkloadTypes(
  owner: CatalogueOwner,
): Promise<CatalogueWorkloadType[]> {
  await ensureWorkloadTypes();
  return listCatalogueWorkloadTypes(owner);
}

export function toWorkloadTypeView(row: CatalogueWorkloadType): WorkloadTypeView {
  return {
    slug: row.slug,
    label: row.label,
    priority: row.priority,
    enabled: row.enabled,
    labelValues: row.labelValues,
    patterns: row.patterns,
    builtin: row.builtin,
    version: row.version,
    source: row.source,
    updateAvailable: row.updateAvailable,
  };
}

/** The screens' shape, highest priority first. */
export async function workloadTypeViews(owner: CatalogueOwner): Promise<WorkloadTypeView[]> {
  return byPriority(await liveWorkloadTypes(owner)).map(toWorkloadTypeView);
}

/** What discovery matches with: the org's effective, ENABLED types in priority order. */
export async function detectableTypes(orgId: string): Promise<DetectableType[]> {
  return byPriority(
    (await liveWorkloadTypes(orgId))
      .filter((t) => t.enabled)
      .map((t) => ({
        slug: t.slug,
        priority: t.priority,
        labelValues: t.labelValues,
        patterns: t.patterns,
      })),
  );
}

/** Slug → label for every type `owner` sees, plus the cluster pseudo-type. */
export async function technologyLabels(
  owner: CatalogueOwner,
): Promise<{ slug: string; label: string; enabled: boolean }[]> {
  return [
    ...(await workloadTypeViews(owner)).map(({ slug, label, enabled }) => ({ slug, label, enabled })),
    { slug: CLUSTER_TECHNOLOGY, label: CLUSTER_TECHNOLOGY_LABEL, enabled: true },
  ];
}

/** Is `slug` a type a workload may be set to in this org right now? */
export async function isAssignableType(orgId: string, slug: string): Promise<boolean> {
  return (await liveWorkloadTypes(orgId)).some((t) => t.slug === slug && t.enabled);
}

/** Is `slug` something a playbook or check scope may name for `owner`? */
export async function isKnownTechnology(owner: CatalogueOwner, slug: string): Promise<boolean> {
  return (
    slug === CLUSTER_TECHNOLOGY ||
    (await liveWorkloadTypes(owner)).some((t) => t.slug === slug)
  );
}
