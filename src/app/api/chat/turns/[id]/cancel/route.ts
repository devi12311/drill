import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { requestTurnCancel } from "@/lib/db/chat-turn-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Stop a turn. A queued one is closed at once; a running one is flagged, and its
 * worker aborts the Holmes call on its next heartbeat (≤5s) — the turn stream
 * shows it as `cancelled` then.
 */
export async function POST(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  const result = await requestTurnCancel(ctx, id);
  if (result === "inactive")
    return Response.json(
      { error: "This investigation is no longer running" },
      { status: 409 },
    );
  return Response.json({ result }, { status: 202 });
}
