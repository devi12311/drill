import { getConnectionSecrets, getRepository } from "@/lib/db/git-queries";
import { errorText, gitApiContext, gitNotFound } from "@/lib/git/access";
import { PROVIDERS } from "@/lib/git/providers";

type Context = { params: Promise<{ id: string }> };

/** The "+ Branch" picker: the provider's branches, marked when already tracked. */
export async function GET(request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const repo = await getRepository(ctx.orgId, id);
  if (!repo) return gitNotFound();
  const connection = await getConnectionSecrets(ctx.orgId, repo.connectionId);
  if (!connection) return gitNotFound();
  const query = new URL(request.url).searchParams.get("q")?.slice(0, 100) ?? undefined;
  try {
    const names = await PROVIDERS[connection.provider].listBranches(connection, repo.fullName, query);
    const tracked = new Set(repo.branches.map((b) => b.name));
    return Response.json({ branches: names.map((name) => ({ name, tracked: tracked.has(name) })) });
  } catch (err) {
    return Response.json({ error: errorText(err) }, { status: 502 });
  }
}
