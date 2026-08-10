import { getAdminActor, forbidden } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { listAudit } from "@/lib/db/admin-queries";

export async function GET(request: Request) {
  if (!(await getAdminActor())) return forbidden();
  const range = rangeFromRequest(request);
  const entries = await listAudit(range);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    entries,
  });
}
