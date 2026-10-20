import { getConnectionSecrets, listRepositories } from "@/lib/db/git-queries";
import { errorText, gitApiContext, gitNotFound } from "@/lib/git/access";
import { PROVIDERS } from "@/lib/git/providers";

type Context = { params: Promise<{ id: string }> };

/** The repo picker: one page of the provider's repositories, marked when already synced. */
export async function GET(request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const connection = await getConnectionSecrets(ctx.orgId, id);
  if (!connection) return gitNotFound();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Math.min(100, Number.parseInt(params.get("page") ?? "1", 10) || 1));
  const query = params.get("q")?.slice(0, 100) ?? undefined;
  try {
    const [result, synced] = await Promise.all([
      PROVIDERS[connection.provider].listRepos(connection, { query, page }),
      listRepositories(ctx.orgId, id),
    ]);
    const added = new Set(synced.map((r) => r.externalId));
    return Response.json({
      repos: result.repos.map((r) => ({ ...r, added: added.has(r.externalId) })),
      hasMore: result.hasMore,
    });
  } catch (err) {
    return Response.json({ error: errorText(err) }, { status: 502 });
  }
}
