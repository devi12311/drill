import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import {
  costByModel,
  costByUser,
  spendOverTime,
} from "@/lib/db/admin-queries";

/** The active org's spend — org section of the console. */
export async function GET(request: Request) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const range = rangeFromRequest(request);
  const filter = { orgId: ctx.orgId };
  const [series, byModel, byUser] = await Promise.all([
    spendOverTime(range, filter),
    costByModel(range, filter),
    costByUser(range, 100, filter),
  ]);
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    spendOverTime: series,
    costByModel: byModel,
    costByUser: byUser,
  });
}
