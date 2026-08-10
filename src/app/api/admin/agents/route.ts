import { getAdminActor, forbidden } from "@/lib/auth/session";
import { listAllAgents } from "@/lib/db/admin-queries";

export async function GET() {
  if (!(await getAdminActor())) return forbidden();
  const agents = await listAllAgents();
  return Response.json({ agents });
}
