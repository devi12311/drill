import type { TurnSnapshot } from "@/lib/chat/types";
import type { MessageSkill } from "@/lib/skills/types";
import type { ChatEntry } from "@/lib/chat/types";

interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  skill: MessageSkill | null;
  model: string | null;
  response: ChatEntry["response"] | null;
}

export interface LoadedConversation {
  agentId: string;
  entries: ChatEntry[];
  turn: TurnSnapshot | null;
}

/**
 * GET /api/conversations/[id] → what the chat pane renders. One loader for the
 * page (opening a conversation) and the chat (refreshing once a turn settles), so
 * the stored-message mapping exists once.
 */
export async function loadConversation(id: string): Promise<LoadedConversation> {
  const res = await fetch(`/api/conversations/${id}`);
  const body = (await res.json().catch(() => null)) as
    | {
        conversation: { agentId: string };
        messages: StoredMessage[];
        turn: TurnSnapshot | null;
      }
    | { error?: string }
    | null;
  if (!res.ok || !body || !("messages" in body))
    throw new Error(
      (body && "error" in body && body.error) || `HTTP ${res.status}`,
    );
  return {
    agentId: body.conversation.agentId,
    turn: body.turn,
    entries: body.messages.map((msg): ChatEntry =>
      msg.role === "user"
        ? { id: msg.id, role: "user", ask: msg.content, skill: msg.skill ?? undefined }
        : {
            id: msg.id,
            role: "assistant",
            response: msg.response ?? undefined,
            model: msg.model ?? undefined,
            error: msg.response ? undefined : "Response not stored",
          },
    ),
  };
}
