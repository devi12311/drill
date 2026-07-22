import { getAuthUser, unauthorized } from "@/lib/auth/session";
import {
  deleteConversation,
  getConversationMessages,
} from "@/lib/db/queries";
import type { HolmesChatResponse } from "@/lib/holmes/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    const rows = await getConversationMessages(user.id, id);
    if (rows === null) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    // Strip conversation_history from raw responses — it is server-side
    // replay state and enormous; the client renders from the rest.
    const result = rows.map((row) => {
      let response = null;
      if (row.rawResponse) {
        const { conversation_history: _history, ...rest } =
          row.rawResponse as HolmesChatResponse;
        response = { ...rest, drill_duration_ms: row.durationMs ?? undefined };
      }
      return {
        id: row.id,
        role: row.role,
        content: row.content,
        model: row.model,
        response,
      };
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    const deleted = await deleteConversation(user.id, id);
    if (!deleted) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
