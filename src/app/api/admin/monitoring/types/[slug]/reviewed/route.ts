import { forbidden, getConsoleContext } from "@/lib/auth/session";
import {
  getCatalogueWorkloadType,
  markWorkloadTypeReviewed,
} from "@/lib/db/monitoring-queries";

type Context = { params: Promise<{ slug: string }> };

/** POST — keep the org's customized type; clears "template updated" until the next change. */
export async function POST(_request: Request, context: Context) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const row = await getCatalogueWorkloadType(ctx.orgId, (await context.params).slug.toLowerCase());
  if (!row || row.source !== "override" || row.templateVersion === null)
    return Response.json({ error: "Only a customized type has a template to review" }, { status: 409 });
  await markWorkloadTypeReviewed(ctx.orgId, row.slug, row.templateVersion);
  return Response.json({ ok: true });
}
