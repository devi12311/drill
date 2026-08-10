import { getAdminActor, forbidden } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import {
  costByModel,
  costByUser,
  spendOverTime,
} from "@/lib/db/admin-queries";

export async function GET(request: Request) {
  if (!(await getAdminActor())) return forbidden();
  const range = rangeFromRequest(request);
  const [series, byModel, byUser] = await Promise.all([
    spendOverTime(range),
    costByModel(range),
    costByUser(range, 100),
  ]);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    spendOverTime: series,
    costByModel: byModel,
    costByUser: byUser,
  });
}
