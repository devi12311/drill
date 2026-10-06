import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { listAgentHealth } from "@/lib/db/admin-queries";

/** The active org's agents — org section of the console. */
export async function GET() {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  return Response.json({ agents: await listAgentHealth(ctx.orgId) });
}
