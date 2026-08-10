import { getAdminActor, forbidden } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { listUsersWithStats } from "@/lib/db/admin-queries";

export async function GET(request: Request) {
  if (!(await getAdminActor())) return forbidden();
  const range = rangeFromRequest(request);
  const users = await listUsersWithStats(range);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    users,
  });
}
