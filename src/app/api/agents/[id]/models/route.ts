import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { getAgent } from "@/lib/db/queries";
import { servedModels } from "@/lib/holmes/validate";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  const agent = await getAgent(ctx.orgId, id);
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  try {
    return Response.json({ models: await servedModels(agent.url, agent.apiKey) });
  } catch (err) {
    return Response.json(
      { models: [], error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
