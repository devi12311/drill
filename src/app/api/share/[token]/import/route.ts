import { setActiveOrg } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { AlreadyImported, importShare, ShareGone } from "@/lib/db/share-queries";
import { SkillNameTaken } from "@/lib/db/skill-queries";
import { isOrgAdmin } from "@/lib/orgs/types";
import { openShareFor, shareGone } from "@/lib/share/access";
import { validateSharePayload } from "@/lib/share/validate";
import { payloadTitle, type SharePayload } from "@/lib/share/types";

type Context = { params: Promise<{ token: string }> };

/**
 * POST /api/share/[token]/import — body { orgId, draft }: copy the reviewed (and
 * possibly edited) draft into one of the caller's orgs, then switch to it so the
 * client lands on the new row.
 *
 * A skill arrives private to the importer. A resolution is read by every member
 * and fed into every investigation's knowledge search, so only an admin of the
 * receiving org may bring one in (docs/DECISIONS.md — "Share links").
 */
export async function POST(request: Request, context: Context) {
  const { token } = await context.params;
  const body = (await request.json().catch(() => null)) ?? {};
  const opened = await openShareFor(token, body.orgId);
  if (opened instanceof Response) return opened;
  const { ctx, link, target } = opened;

  if (link.kind === "resolution" && !isOrgAdmin(target.role))
    return Response.json(
      { error: `Only an admin of ${target.orgName} can import a resolution` },
      { status: 403 },
    );

  let payload: SharePayload;
  try {
    payload = validateSharePayload(link.kind, body.draft);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid draft" },
      { status: 400 },
    );
  }

  let imported: { id: string };
  try {
    imported = await importShare(link, { userId: ctx.userId, targetOrgId: target.orgId }, payload);
  } catch (err) {
    if (err instanceof ShareGone) return shareGone();
    if (err instanceof SkillNameTaken)
      return Response.json({ error: err.message, field: "name" }, { status: 409 });
    if (err instanceof AlreadyImported)
      return Response.json(
        { error: `You already imported this into ${target.orgName}` },
        { status: 409 },
      );
    throw err;
  }

  if (target.orgId !== ctx.orgId) await setActiveOrg(target.orgId);
  await writeAudit({
    actorId: ctx.userId,
    orgId: target.orgId,
    action: "share.imported",
    metadata: {
      linkId: link.id,
      kind: link.kind,
      importedId: imported.id,
      title: payloadTitle(payload),
      fromOrgId: link.orgId,
      fromOrgName: link.orgName,
    },
  });
  return Response.json({ id: imported.id, kind: link.kind }, { status: 201 });
}
