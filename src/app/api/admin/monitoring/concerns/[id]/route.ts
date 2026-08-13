import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  getConcern,
  getConcernHistory,
  setConcernLifecycle,
} from "@/lib/db/monitoring-queries";
import type { ConcernStatus } from "@/lib/monitoring/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * The lifecycle transitions a human may perform. Machine transitions (`open`,
 * `auto_resolved`) belong to reconciliation and are deliberately not offered
 * here — an operator marking something fixed uses `resolved`, which stays
 * distinguishable from the checker no longer seeing it.
 */
const ACTIONS = {
  resolve: { status: "resolved" as ConcernStatus, needsReason: false },
  mute: { status: "muted" as ConcernStatus, needsReason: true },
  accept_risk: { status: "accepted_risk" as ConcernStatus, needsReason: true },
  false_positive: {
    status: "false_positive" as ConcernStatus,
    needsReason: true,
  },
  reopen: { status: "open" as ConcernStatus, needsReason: false },
} as const;

type Action = keyof typeof ACTIONS;

export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const concern = await getConcern(id);
  if (!concern) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ concern, history: await getConcernHistory(id) });
}

export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const concern = await getConcern(id);
  if (!concern) return Response.json({ error: "Not found" }, { status: 404 });

  let body: { action?: string; comment?: string; muteDays?: number };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = body.action as Action | undefined;
  if (!action || !(action in ACTIONS))
    return Response.json(
      { error: `action must be one of: ${Object.keys(ACTIONS).join(", ")}` },
      { status: 400 },
    );

  const spec = ACTIONS[action];
  const comment = body.comment?.trim() ?? "";
  if (spec.needsReason && !comment)
    return Response.json(
      { error: "A comment is required when muting, accepting or dismissing" },
      { status: 400 },
    );

  let mutedUntil: Date | null = null;
  if (action === "mute") {
    const days = Number(body.muteDays ?? 30);
    if (!Number.isFinite(days) || days < 1 || days > 365)
      return Response.json(
        { error: "muteDays must be between 1 and 365" },
        { status: 400 },
      );
    mutedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  const updated = await setConcernLifecycle(id, {
    status: spec.status,
    dismissalReason: action === "reopen" ? null : action,
    dismissalComment: action === "reopen" ? null : comment || null,
    dismissedBy: action === "reopen" ? null : actor.id,
    mutedUntil,
    // A human decision restarts the auto-resolve countdown; otherwise a
    // reopened concern would auto-resolve on the very next absent run.
    consecutiveRunsAbsent: 0,
    // A human marking it fixed stamps the resolution time; reopening clears it
    // so the next reconciliation treats the concern as live again.
    lastResolvedAt:
      action === "resolve"
        ? new Date()
        : action === "reopen"
          ? null
          : concern.lastResolvedAt,
  });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });

  await writeAudit({
    actorId: actor.id,
    action: `monitoring.concern.${action}`,
    metadata: {
      concernId: id,
      jobId: concern.jobId,
      checkId: concern.checkId,
      target: `${concern.targetKind}/${concern.targetNamespace}/${concern.targetName}`,
      comment: comment || undefined,
      mutedUntil: mutedUntil?.toISOString(),
    },
  });
  return Response.json(updated);
}
