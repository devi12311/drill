import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { getCatalogueCheck, markCheckReviewed } from "@/lib/db/monitoring-queries";

type Context = { params: Promise<{ id: string }> };

/**
 * POST — "keep my version": the org has looked at the template's change and
 * stays on its copy, which stops being flagged until the template moves again.
 */
export async function POST(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const row = await getCatalogueCheck(ctx.orgId, (await context.params).id);
  if (!row || row.source !== "override" || row.templateVersion === null)
    return Response.json({ error: "Only a customized check has a template to review" }, { status: 409 });
  await markCheckReviewed(ctx.orgId, row.id, row.templateVersion);
  return Response.json({ ok: true });
}
