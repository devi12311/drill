import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { listAudit } from "@/lib/db/admin-queries";

/**
 * The audit trail of the active org — an org section of the console, so org
 * owners/admins see who changed their members, agents, catalogue and monitoring.
 * `?scope=all` (platform admins only) is every org's, platform actions included.
 */
export async function GET(request: Request) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const all = new URL(request.url).searchParams.get("scope") === "all";
  if (all && !ctx.isPlatformAdmin) return forbidden();
  const range = rangeFromRequest(request);
  const entries = await listAudit(range, all ? {} : { orgId: ctx.orgId });
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    entries,
  });
}
