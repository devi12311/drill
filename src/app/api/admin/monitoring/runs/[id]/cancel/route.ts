import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { requestCancel } from "@/lib/db/monitoring-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Cancel a run. A queued run is closed immediately; a running one is flagged, and
 * its worker aborts the Holmes call on its next heartbeat and reconciles whatever
 * already finished — so the response says which of the two happened.
 */
export async function POST(_request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;

  const result = await requestCancel(id, actor.id);
  if (result === "inactive")
    return Response.json(
      { error: "This run has already finished" },
      { status: 409 },
    );
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.run.cancelled",
    metadata: { runId: id, stage: result },
  });
  return Response.json({ result }, { status: 202 });
}
