import { getConnectionSecrets, recordConnectionContact } from "@/lib/db/git-queries";
import { errorText, gitApiContext, gitNotFound } from "@/lib/git/access";
import { PROVIDERS } from "@/lib/git/providers";

type Context = { params: Promise<{ id: string }> };

/** "Check now": the worker's periodic probe, on demand. The outcome is stamped either way. */
export async function POST(_request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const connection = await getConnectionSecrets(ctx.orgId, id);
  if (!connection) return gitNotFound();
  try {
    await PROVIDERS[connection.provider].validate(connection);
    await recordConnectionContact(id, null);
    return Response.json({ ok: true });
  } catch (err) {
    await recordConnectionContact(id, errorText(err));
    return Response.json({ ok: false, error: errorText(err) });
  }
}
