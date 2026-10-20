import { writeAudit } from "@/lib/db/admin-queries";
import { isUniqueViolation } from "@/lib/db";
import { createConnection, listConnections } from "@/lib/db/git-queries";
import { errorText, gitApiContext, jsonBody, unprocessable } from "@/lib/git/access";
import { parseConnection, type ConnectionBody } from "@/lib/git/connection-input";
import { PROVIDERS } from "@/lib/git/providers";
import { isGitProvider } from "@/lib/git/types";

export async function GET() {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  return Response.json({ connections: await listConnections(ctx.orgId) });
}

/**
 * Connect an account. The token is proved against the provider BEFORE the row is
 * written — a connection that cannot list its repositories is not saved.
 */
export async function POST(request: Request) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const body = await jsonBody<ConnectionBody>(request);
  if (body instanceof Response) return body;

  if (!isGitProvider(body.provider)) return unprocessable("Choose GitHub or Bitbucket", "provider");
  const provider = body.provider;
  const fields = parseConnection(body, provider);
  if (fields instanceof Response) return fields;
  const token = body.token?.trim() ?? "";
  if (!token) return unprocessable("A token is required", "token");

  try {
    await PROVIDERS[provider].validate({ ...fields, token });
  } catch (err) {
    return unprocessable(errorText(err), "token");
  }

  let connection;
  try {
    connection = await createConnection(ctx, { provider, ...fields, token });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return Response.json({ error: `A connection named "${fields.name}" already exists`, field: "name" }, { status: 409 });
    }
    throw err;
  }
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "git.connection.created",
    metadata: { connectionId: connection.id, provider, name: fields.name, account: fields.account },
  });
  return Response.json(connection, { status: 201 });
}
