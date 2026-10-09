import { forbidden, getAuthContext, unauthorized } from "@/lib/auth/session";
import { isAnswerMode, validateAnswerRules } from "@/lib/chat/answer-style";
import { writeAudit } from "@/lib/db/admin-queries";
import { getAnswerStyle, renameOrg, updateAnswerStyle } from "@/lib/db/org-queries";
import { validateOrgName } from "@/lib/orgs/types";

/**
 * PATCH /api/org — the active org's settings (org admins). Body { name } renames
 * it; { answer_mode, answer_rules } sets how Holmes words answers
 * (lib/chat/answer-style.ts). Each is audited separately.
 */
export async function PATCH(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  let body: { name?: unknown; answer_mode?: unknown; answer_rules?: unknown };
  let name: string | null = null;
  let answerRules: string | null = null;
  const hasStyle = (b: typeof body) => "answer_mode" in b || "answer_rules" in b;
  try {
    body = (await request.json()) ?? {};
    if ("name" in body) name = validateOrgName(body.name);
    if ("answer_mode" in body && !isAnswerMode(body.answer_mode))
      throw new Error('Answer mode must be "brief" or "detailed"');
    if ("answer_rules" in body) answerRules = validateAnswerRules(body.answer_rules);
    if (name == null && !hasStyle(body)) throw new Error("Nothing to change");
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid JSON body" },
      { status: 400 },
    );
  }

  if (name != null) {
    await renameOrg(ctx.orgId, name);
    await writeAudit({
      actorId: ctx.userId,
      orgId: ctx.orgId,
      action: "org.renamed",
      metadata: { from: ctx.orgName, to: name },
    });
  }
  if (hasStyle(body)) {
    // A partial update keeps the other half as it is.
    const before = await getAnswerStyle(ctx.orgId);
    const after = {
      answerMode: isAnswerMode(body.answer_mode) ? body.answer_mode : before.answerMode,
      answerRules: "answer_rules" in body ? answerRules : before.answerRules,
    };
    await updateAnswerStyle(ctx.orgId, after);
    await writeAudit({
      actorId: ctx.userId,
      orgId: ctx.orgId,
      action: "org.answer_style_changed",
      metadata: {
        from: before.answerMode,
        to: after.answerMode,
        rulesChanged: before.answerRules !== after.answerRules,
      },
    });
    return Response.json({ name: name ?? ctx.orgName, ...after });
  }
  return Response.json({ name });
}
