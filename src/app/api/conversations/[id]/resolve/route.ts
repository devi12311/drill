import fs from "node:fs/promises";
import path from "node:path";
import { getAuthUser, unauthorized } from "@/lib/auth/session";
import {
  getAgent,
  getConversation,
  getConversationTranscript,
} from "@/lib/db/queries";
import { fixtureMode } from "@/lib/holmes/stream";
import { distillArtifact } from "@/lib/artifacts/distill";
import { parseArtifactDraft } from "@/lib/artifacts/types";

// Distillation is a real LLM call — allow it the time it needs.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

/**
 * Generate a resolution-artifact draft from this conversation by sending a
 * condensed transcript back to the user's Holmes agent with a strict JSON
 * response_format. Nothing is saved — the review dialog owns saving.
 */
export async function POST(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;

  const conversation = await getConversation(user.id, id);
  if (!conversation) {
    return Response.json({ error: "Conversation not found" }, { status: 404 });
  }
  const turns = await getConversationTranscript(id);
  if (!turns.some((t) => t.role === "assistant")) {
    return Response.json(
      { error: "Nothing to resolve yet — run an investigation first" },
      { status: 422 },
    );
  }

  if (fixtureMode()) {
    const file = path.join(process.cwd(), "fixtures", "resolution-artifact.json");
    const draft = parseArtifactDraft(await fs.readFile(file, "utf-8"));
    return Response.json({ draft });
  }

  const agent = await getAgent(user.id, conversation.agentId);
  if (!agent) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }
  try {
    const draft = await distillArtifact(
      { url: agent.url, apiKey: agent.apiKey },
      conversation.model,
      turns,
    );
    return Response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "distillation failed";
    return Response.json(
      { error: `Holmes could not distill this conversation: ${message}` },
      { status: 502 },
    );
  }
}
