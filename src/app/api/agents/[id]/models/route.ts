import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { getAgent } from "@/lib/db/queries";
import { validateAgent } from "@/lib/holmes/validate";
import { KNOWN_MODELS } from "@/lib/holmes/types";

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
    return Response.json({ models: await validateAgent(agent.url, agent.apiKey) });
  } catch {
    return Response.json({ models: KNOWN_MODELS });
  }
}
