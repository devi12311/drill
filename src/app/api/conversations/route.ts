import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { listConversations } from "@/lib/db/queries";

export async function GET(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const agentId = new URL(request.url).searchParams.get("agent_id");
  if (!agentId) {
    return Response.json({ error: "agent_id is required" }, { status: 400 });
  }
  try {
    return Response.json(await listConversations(user.id, agentId));
  } catch {
    return Response.json(
      { error: "Database unreachable (run `docker compose up -d` in drill/)" },
      { status: 503 },
    );
  }
}
