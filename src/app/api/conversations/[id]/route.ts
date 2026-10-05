import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { getOpenTurn } from "@/lib/db/chat-turn-queries";
import {
  deleteConversation,
  getConversation,
  getConversationMessages,
} from "@/lib/db/queries";
import type { HolmesChatResponse } from "@/lib/holmes/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * A conversation as the chat pane opens it: its agent (so a `?c=` link can switch
 * to it), its messages, and its open turn — the one to reattach to, or to offer
 * Resume on.
 */
export async function GET(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    const conversation = await getConversation(user.id, id);
    const rows = conversation && (await getConversationMessages(user.id, id));
    if (!conversation || !rows) {
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
        skill: row.skill,
        model: row.model,
        response,
      };
    });
    return Response.json({
      conversation: { id: conversation.id, agentId: conversation.agentId },
      messages: result,
      turn: await getOpenTurn(conversation.id),
    });
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    // An open turn cascades away with it; its worker's next heartbeat finds no
    // row and aborts the Holmes call (lib/chat/runner.ts, "lost").
    const deleted = await deleteConversation(user.id, id);
    if (!deleted) {
      return Response.json({ error: "Conversation not found" }, { status: 404 });
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
