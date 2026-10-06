import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { markPlaybookReviewed } from "@/lib/db/monitoring-queries";
import { cataloguePlaybook } from "@/lib/monitoring/playbooks";

type Context = { params: Promise<{ technology: string }> };

/**
 * POST — "keep my version": the org has looked at the template's change and
 * stays on its fork, which stops being flagged until the template moves again.
 */
export async function POST(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const technology = (await context.params).technology.toLowerCase();
  const row = await cataloguePlaybook(ctx.orgId, technology);
  if (!row || row.source !== "override" || row.templateVersion === null)
    return Response.json({ error: "Only a customized playbook has a template to review" }, { status: 409 });
  await markPlaybookReviewed(ctx.orgId, technology, row.templateVersion);
  return Response.json({ ok: true });
}
