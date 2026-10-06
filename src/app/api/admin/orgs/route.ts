import { forbidden, getAdminActor } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { listOrgsWithStats } from "@/lib/db/admin-queries";

/** Every org with its size and spend — platform admins only. */
export async function GET(request: Request) {
  if (!(await getAdminActor())) return forbidden();
  const range = rangeFromRequest(request);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    orgs: await listOrgsWithStats(range),
  });
}
