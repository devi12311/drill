import { declineShare } from "@/lib/db/share-queries";
import { openShareFor } from "@/lib/share/access";

type Context = { params: Promise<{ token: string }> };

/**
 * POST /api/share/[token]/decline — body { orgId }. "Not now": recorded for the
 * sharer's counts, but the link stays usable — importing later overwrites it.
 */
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  const body = (await request.json().catch(() => null)) ?? {};
  const opened = await openShareFor(token, body.orgId);
  if (opened instanceof Response) return opened;
  await declineShare(opened.link.id, {
    userId: opened.ctx.userId,
    targetOrgId: opened.target.orgId,
  });
  return Response.json({ ok: true });
}
