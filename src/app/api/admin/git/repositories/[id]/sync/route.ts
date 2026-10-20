import { getRepository, queueSync } from "@/lib/db/git-queries";
import { gitApiContext, gitNotFound } from "@/lib/git/access";

type Context = { params: Promise<{ id: string }> };

/** Queue one branch (`branchId`) or every tracked branch of the repository. */
export async function POST(request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const repo = await getRepository(ctx.orgId, id);
  if (!repo) return gitNotFound();
  // The body is optional: an empty POST means "all branches".
  let body: { branchId?: string } = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }
  if (body.branchId && !repo.branches.some((b) => b.id === body.branchId)) return gitNotFound();
  return Response.json({ queued: await queueSync(ctx.orgId, { repositoryId: id, branchId: body.branchId }) });
}
