import { writeAudit } from "@/lib/db/admin-queries";
import { isUniqueViolation } from "@/lib/db";
import { deleteConnection, getConnectionSecrets, listRepositories, updateConnection } from "@/lib/db/git-queries";
import { errorText, gitApiContext, gitNotFound, jsonBody, unprocessable } from "@/lib/git/access";
import { PROVIDERS } from "@/lib/git/providers";
import { parseConnection, type ConnectionBody } from "@/lib/git/connection-input";

type Context = { params: Promise<{ id: string }> };

/**
 * Edit a connection. The token is write-only: omitting it keeps the stored one
 * (same convention as agents and clusters). Changed credentials are re-proved
 * before saving. The account is fixed once repositories sync from it — they live
 * under that owner/workspace.
 */
export async function PATCH(request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const existing = await getConnectionSecrets(ctx.orgId, id);
  if (!existing) return gitNotFound();
  const body = await jsonBody<ConnectionBody>(request);
  if (body instanceof Response) return body;

  const fields = parseConnection(
    {
      name: body.name ?? existing.name,
      account: body.account ?? existing.account,
      username: body.username === undefined ? existing.username : body.username,
    },
    existing.provider,
  );
  if (fields instanceof Response) return fields;
  const token = body.token?.trim() || existing.token;

  if (fields.account !== existing.account && (await listRepositories(ctx.orgId, id)).length > 0) {
    return Response.json(
      { error: "Remove this connection's repositories before changing its account", field: "account" },
      { status: 409 },
    );
  }
  const credentialsChanged =
    token !== existing.token || fields.account !== existing.account || fields.username !== existing.username;
  if (credentialsChanged) {
    try {
      await PROVIDERS[existing.provider].validate({ ...fields, token });
    } catch (err) {
      return unprocessable(errorText(err), "token");
    }
  }

  let connection;
  try {
    connection = await updateConnection(ctx.orgId, id, { ...fields, token });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json({ error: `A connection named "${fields.name}" already exists`, field: "name" }, { status: 409 });
    }
    throw err;
  }
  if (!connection) return gitNotFound();
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "git.connection.updated",
    metadata: { connectionId: id, name: fields.name, tokenRotated: token !== existing.token },
  });
  return Response.json(connection);
}

export async function DELETE(_request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const result = await deleteConnection(ctx.orgId, id);
  if (result === "missing") return gitNotFound();
  if (result === "in-use") {
    return Response.json({ error: "Remove this connection's repositories first" }, { status: 409 });
  }
  await writeAudit({ actorId: ctx.userId, orgId: ctx.orgId, action: "git.connection.deleted", metadata: { connectionId: id } });
  return Response.json({ ok: true });
}
