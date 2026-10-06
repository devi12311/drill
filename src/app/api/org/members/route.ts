import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { listMembers } from "@/lib/db/org-queries";

/** GET /api/org/members — everyone in the active org; visible to every member. */
export async function GET() {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  return Response.json(await listMembers(ctx.orgId));
}
