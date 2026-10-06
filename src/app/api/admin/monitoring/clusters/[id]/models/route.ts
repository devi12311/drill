import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { monitoringNotFound, ownsMonitoring } from "@/lib/monitoring/access";
import { getClusterSecrets } from "@/lib/db/monitoring-queries";
import { servedModels } from "@/lib/holmes/validate";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Models offered by THIS cluster's Holmes — the agent that will actually run
 * its jobs. No fallback list: offering names the agent may no longer serve is
 * worse than offering none.
 */
export async function GET(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const { id } = await context.params;
  if (!(await ownsMonitoring(ctx, { cluster: id }))) return monitoringNotFound();
  const cluster = await getClusterSecrets(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json({
      models: await servedModels(cluster.holmesUrl, cluster.holmesApiKey),
    });
  } catch (err) {
    return Response.json(
      { models: [], error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
