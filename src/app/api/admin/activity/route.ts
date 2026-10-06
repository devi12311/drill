import { forbidden, getConsoleContext } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { recentInvestigations } from "@/lib/db/admin-queries";
import { isUuid } from "@/lib/uuid";

/** The active org's investigations — org section of the console. */
export async function GET(request: Request) {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const range = rangeFromRequest(request);
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const investigations = await recentInvestigations({
    range,
    filter: {
      orgId: ctx.orgId,
      userId: userId && isUuid(userId) ? userId : undefined,
    },
    model: searchParams.get("model") ?? undefined,
    limit: 150,
  });
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    investigations,
  });
}
