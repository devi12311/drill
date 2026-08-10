import { getAdminActor, forbidden } from "@/lib/auth/session";
import { rangeFromRequest } from "@/lib/admin/http";
import { userDetail } from "@/lib/db/admin-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const range = rangeFromRequest(request);
  const detail = await userDetail(id, range);
  if (!detail) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    range: { range: range.range, from: range.from, to: range.to },
    ...detail,
  });
}
