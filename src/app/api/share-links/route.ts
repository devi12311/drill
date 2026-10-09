import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { getArtifact } from "@/lib/db/queries";
import { createShareLink, listShareLinks } from "@/lib/db/share-queries";
import { getSkillView } from "@/lib/db/skill-queries";
import { artifactToDraft } from "@/lib/artifacts/types";
import { DEFAULT_SHARE_EXPIRY_DAYS, payloadTitle, type SharePayload } from "@/lib/share/types";
import {
  isShareAudience,
  isShareExpiry,
  isShareKind,
  validateSharePayload,
} from "@/lib/share/validate";

const fail = (error: string, status: number) => Response.json({ error }, { status });

/** GET /api/share-links[?sourceId=] — the org's live links (a member's own, unless admin). */
export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const sourceId = new URL(request.url).searchParams.get("sourceId") ?? undefined;
  return Response.json(await listShareLinks(ctx, sourceId));
}

/**
 * POST /api/share-links — body { kind, sourceId, audience, expiresInDays?, draft? }.
 *
 * Who may share what (docs/DECISIONS.md — "Share links"):
 *  - a skill with the org (`org`): its author, or an org admin;
 *  - anything outside the org (`any`): an org admin only;
 *  - a resolution: only `any` — every member already reads it — so admin only.
 *
 * A skill's snapshot is the stored skill (its author edits the skill itself); a
 * resolution's may be the admin's edited `draft`, since redacting what leaves
 * the org is the point of reviewing it. Returns the raw token once.
 */
export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const body = (await request.json().catch(() => null)) ?? {};
  const { kind, audience, sourceId } = body;
  const expiresInDays = body.expiresInDays ?? DEFAULT_SHARE_EXPIRY_DAYS;
  if (!isShareKind(kind) || !isShareAudience(audience) || typeof sourceId !== "string")
    return fail("kind, audience and sourceId are required", 400);
  if (!isShareExpiry(expiresInDays)) return fail("expiresInDays must be 7, 30 or 90", 400);
  if (audience === "any" && !ctx.isOrgAdmin)
    return fail("Only an org admin can share outside the organization", 403);

  // The stored item, as the draft its kind's validator takes.
  let raw: unknown;
  if (kind === "skill") {
    const skill = await getSkillView(ctx, sourceId);
    if (!skill) return fail("Skill not found", 404);
    if (!ctx.isOrgAdmin && skill.createdBy !== ctx.userId)
      return fail("You can share only skills you wrote", 403);
    raw = skill;
  } else {
    if (audience !== "any")
      return fail("Everyone in the organization already sees its resolutions", 400);
    const artifact = await getArtifact(ctx.orgId, sourceId);
    if (!artifact) return fail("Resolution not found", 404);
    raw = body.draft ?? artifactToDraft(artifact);
  }
  let payload: SharePayload;
  try {
    payload = validateSharePayload(kind, raw);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Invalid draft", 400);
  }

  const title = payloadTitle(payload);
  const link = await createShareLink(ctx, {
    kind,
    audience,
    sourceId,
    title,
    payload,
    expiresInDays,
  });
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "share.link.created",
    metadata: { linkId: link.id, kind, audience, sourceId, title, expiresInDays },
  });
  return Response.json(link, { status: 201 });
}
