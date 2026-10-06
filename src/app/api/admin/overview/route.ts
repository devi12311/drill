import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import {
  costByModel,
  costByUser,
  overviewKpis,
  spendOverTime,
} from "@/lib/db/admin-queries";

/** The active org's headline numbers — org section of the console. */
export async function GET(request: Request) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const range = rangeFromRequest(request);
  const filter = { orgId: ctx.orgId };
  const [kpis, series, byModel, byUser] = await Promise.all([
    overviewKpis(range, filter),
    spendOverTime(range, filter),
    costByModel(range, filter),
    costByUser(range, 8, filter),
  ]);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    kpis,
    spendOverTime: series,
    costByModel: byModel,
    topUsers: byUser,
  });
}
