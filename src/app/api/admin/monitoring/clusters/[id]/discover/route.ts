import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { monitoringNotFound, ownsMonitoring } from "@/lib/monitoring/access";
import { refreshInventory } from "@/lib/monitoring/inventory";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/** Re-scan a cluster now, rather than waiting for the worker's next refresh. */
export async function POST(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const { id } = await context.params;
  if (!(await ownsMonitoring(ctx, { cluster: id }))) return monitoringNotFound();
  const result = await refreshInventory(id, ctx.orgId);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  if (!result.ok) return Response.json({ error: result.error }, { status: 422 });
  const { context: kubeContext, server, total, removed } = result;
  return Response.json({ context: kubeContext, server, total, removed });
}
