import { forbidden, getAdminActor } from "@/lib/auth/session";
import { getRun, getRunFindings } from "@/lib/db/monitoring-queries";
import { checkSummaries } from "@/lib/monitoring/checks";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    run,
    findings: await getRunFindings(id),
    // The catalogue travels with the run so the UI can name and cite a check
    // (including ones that only appear in `coverage.skipped`, and custom ones).
    checks: await checkSummaries(),
  });
}
