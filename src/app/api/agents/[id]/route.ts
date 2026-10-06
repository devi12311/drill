import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { deleteAgent, getAgent, updateAgent } from "@/lib/db/queries";
import { validateAgent } from "@/lib/holmes/validate";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;

  const existing = await getAgent(ctx.orgId, id);
  if (!existing) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  let body: { name?: string; url?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim() || existing.name;
  const url = (body.url?.trim() || existing.url).replace(/\/$/, "");
  const apiKey = body.apiKey?.trim() || existing.apiKey;

  let models: string[];
  try {
    models = await validateAgent(url, apiKey);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Validation failed" },
      { status: 422 },
    );
  }

  const agent = await updateAgent(ctx, id, { name, url, apiKey });
  if (!agent) return notYours();
  return Response.json({ ...agent, models });
}

export async function DELETE(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  if (!(await getAgent(ctx.orgId, id))) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  if (!(await deleteAgent(ctx, id))) return notYours();
  return Response.json({ ok: true });
}

/** The agent is the org's, but only its registrant or an org admin may change it. */
function notYours() {
  return Response.json(
    { error: "Only whoever added this agent, or an org admin, can change it" },
    { status: 403 },
  );
}
