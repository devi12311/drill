import { getConnectionSummary, queueSync } from "@/lib/db/git-queries";
import { gitApiContext, gitNotFound } from "@/lib/git/access";

type Context = { params: Promise<{ id: string }> };

/** "Sync all": queue every tracked branch of every repository on this connection. */
export async function POST(_request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  if (!(await getConnectionSummary(ctx.orgId, id))) return gitNotFound();
  return Response.json({ queued: await queueSync(ctx.orgId, { connectionId: id }) });
}
