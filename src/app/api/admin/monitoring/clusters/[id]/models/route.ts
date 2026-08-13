import { forbidden, getAdminActor } from "@/lib/auth/session";
import { getClusterSecrets } from "@/lib/db/monitoring-queries";
import { validateAgent } from "@/lib/holmes/validate";
import { KNOWN_MODELS } from "@/lib/holmes/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Models offered by THIS cluster's Holmes — the agent that will actually run
 * its jobs. Falls back to the known list rather than failing the job form,
 * mirroring GET /api/models.
 */
export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const cluster = await getClusterSecrets(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json({
      models: await validateAgent(cluster.holmesUrl, cluster.holmesApiKey),
    });
  } catch {
    return Response.json({ models: KNOWN_MODELS, fallback: true });
  }
}
