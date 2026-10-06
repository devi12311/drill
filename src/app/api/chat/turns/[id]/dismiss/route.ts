import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { dismissTurn } from "@/lib/db/chat-turn-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/** Keep a stopped turn's partial results in the transcript and close it. */
export async function POST(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  const result = await dismissTurn(ctx, id);
  if (result === "missing")
    return Response.json({ error: "Not found" }, { status: 404 });
  if (result === "active")
    return Response.json(
      { error: "Stop the investigation before dismissing it" },
      { status: 409 },
    );
  return Response.json({ ok: true });
}
