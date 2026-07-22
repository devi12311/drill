import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { createAgent, listAgents } from "@/lib/db/queries";
import { validateAgent } from "@/lib/holmes/validate";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  return Response.json(await listAgents(user.id));
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: { name?: string; url?: string; apiKey?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim() ?? "";
  const url = body.url?.trim().replace(/\/$/, "") ?? "";
  const apiKey = body.apiKey?.trim() ?? "";
  if (!name || !url || !apiKey) {
    return Response.json(
      { error: "name, url and apiKey are required" },
      { status: 400 },
    );
  }
  if (!/^https?:\/\//.test(url)) {
    return Response.json(
      { error: "url must start with http:// or https://" },
      { status: 400 },
    );
  }

  let models: string[];
  try {
    models = await validateAgent(url, apiKey);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Validation failed" },
      { status: 422 },
    );
  }

  const agent = await createAgent(user.id, { name, url, apiKey });
  return Response.json({ ...agent, models });
}
