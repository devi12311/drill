import { getAuthContext, setActiveOrg, unauthorized } from "@/lib/auth/session";

/** POST /api/orgs/active — body { orgId }. Switch the org this browser works in. */
export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const orgId = (await request.json().catch(() => null))?.orgId;
  if (!ctx.memberships.some((m) => m.orgId === orgId)) {
    return Response.json({ error: "Organization not found" }, { status: 404 });
  }
  await setActiveOrg(orgId);
  return Response.json({ ok: true });
}
