import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { dismissTurn } from "@/lib/db/chat-turn-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/** Keep a stopped turn's partial results in the transcript and close it. */
export async function POST(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  const result = await dismissTurn(user.id, id);
  if (result === "missing")
    return Response.json({ error: "Not found" }, { status: 404 });
  if (result === "active")
    return Response.json(
      { error: "Stop the investigation before dismissing it" },
      { status: 409 },
    );
  return Response.json({ ok: true });
}
