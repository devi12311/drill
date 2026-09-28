import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { getAgent } from "@/lib/db/queries";
import { servedModels } from "@/lib/holmes/validate";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const agent = await getAgent(user.id, id);
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
