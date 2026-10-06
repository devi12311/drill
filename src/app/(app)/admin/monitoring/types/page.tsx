import { WorkloadTypesBrowser } from "@/components/monitoring/workload-types-browser";
import { listClusters } from "@/lib/db/monitoring-queries";
import { cataloguePageOwner, monitoringPageContext } from "@/lib/monitoring/access";
import { workloadTypeViews } from "@/lib/monitoring/workload-types-live";

/**
 * What a workload can be, and how discovery recognises it (docs/DECISIONS.md 128).
 * Beside the check catalogue and the playbooks because it is the third half of the
 * same vocabulary: a type is what checks scope to and what a playbook is for.
 */
export default async function WorkloadTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const { owner, scope, canEditTemplates } = await cataloguePageOwner(
    (await searchParams).scope,
  );
  const { orgId } = await monitoringPageContext();
  const [types, clusters] = await Promise.all([
    workloadTypeViews(owner),
    listClusters(orgId),
  ]);
  return (
    <WorkloadTypesBrowser
      types={types}
      scope={scope}
      canEditTemplates={canEditTemplates}
      clusterIds={clusters.map((c) => c.id)}
    />
  );
}
