import { getAdminActor, forbidden } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { recentInvestigations } from "@/lib/db/admin-queries";

export async function GET(request: Request) {
  if (!(await getAdminActor())) return forbidden();
  const range = rangeFromRequest(request);
  const { searchParams } = new URL(request.url);
  const investigations = await recentInvestigations({
    range,
    userId: searchParams.get("userId") ?? undefined,
    model: searchParams.get("model") ?? undefined,
    limit: 150,
  });
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    investigations,
  });
}
