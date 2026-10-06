import { forbidden, getAuthContext, unauthorized } from "@/lib/auth/session";
import { clustersUsingAgent } from "@/lib/db/monitoring-queries";
import { deleteAgent, getAgent, updateAgent } from "@/lib/db/queries";
import { validateAgent } from "@/lib/holmes/validate";

type Context = { params: Promise<{ id: string }> };

/** Owners and admins only — monitored clusters follow the change, see schema.ts. */
export async function PATCH(request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  const { id } = await context.params;

  const existing = await getAgent(ctx.orgId, id);
  if (!existing) return notFound();

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

  const agent = await updateAgent(ctx.orgId, id, { name, url, apiKey });
  if (!agent) return notFound();
  return Response.json({ ...agent, models });
}

export async function DELETE(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  const { id } = await context.params;
  if (!(await getAgent(ctx.orgId, id))) return notFound();
  // The FK would refuse too; checking first names the clusters to repoint.
  const clusters = await clustersUsingAgent(ctx.orgId, id);
  if (clusters.length > 0) {
    return Response.json(
      {
        error: `Monitoring uses this agent for ${clusters.join(", ")}. Point ${
          clusters.length === 1 ? "that cluster" : "those clusters"
        } at another agent first.`,
      },
      { status: 409 },
    );
  }
  if (!(await deleteAgent(ctx.orgId, id))) return notFound();
  return Response.json({ ok: true });
}

function notFound() {
  return Response.json({ error: "Agent not found" }, { status: 404 });
}
