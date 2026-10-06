import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { monitoringNotFound, ownsMonitoring } from "@/lib/monitoring/access";
import { runProgress } from "@/lib/db/monitoring-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * A run's status and progress — what the progress banner polls. Two small indexed
 * reads; the full run (coverage, raw responses, prompts) is never sent for this.
 */
export async function GET(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const { id } = await context.params;
  if (!(await ownsMonitoring(ctx, { run: id }))) return monitoringNotFound();
  const progress = await runProgress(id);
  if (!progress) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(progress);
}
