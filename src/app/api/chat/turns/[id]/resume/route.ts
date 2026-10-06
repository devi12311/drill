import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { resumeTurn } from "@/lib/db/chat-turn-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/** Re-queue a failed or stopped turn; the worker continues it from its saved evidence. */
export async function POST(_request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;
  if (!(await resumeTurn(ctx, id)))
    return Response.json(
      { error: "This investigation cannot be resumed" },
      { status: 409 },
    );
  return Response.json({ ok: true }, { status: 202 });
}
