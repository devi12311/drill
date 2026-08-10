import { getAdminActor, forbidden } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import {
  costByModel,
  costByUser,
  overviewKpis,
  spendOverTime,
} from "@/lib/db/admin-queries";

export async function GET(request: Request) {
  if (!(await getAdminActor())) return forbidden();
  const range = rangeFromRequest(request);
  const [kpis, series, byModel, byUser] = await Promise.all([
    overviewKpis(range),
    spendOverTime(range),
    costByModel(range),
    costByUser(range, 8),
  ]);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    kpis,
    spendOverTime: series,
    costByModel: byModel,
    topUsers: byUser,
  });
}
