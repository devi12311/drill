import { getAuthUser, unauthorized } from "@/lib/auth/session";
import {
  addAssistantMessage,
  addUserMessage,
  createConversation,
  getAgent,
  getConversation,
  getReplayHistory,
} from "@/lib/db/queries";
import { fixtureMode, streamHolmes, type StreamOutcome } from "@/lib/holmes/stream";
import { DEFAULT_MODEL, type HolmesChatRequest } from "@/lib/holmes/types";
import {
  buildInjectionPrompt,
  RELEVANCE_FLOOR,
  searchArtifacts,
  SEARCH_TOOL_DEF,
} from "@/lib/artifacts/search";

export const maxDuration = 900;

/**
 * POST /api/chat — body: { ask, model?, agent_id, conversation_id? }.
 * Responds with an SSE stream of DrillEvents (see lib/holmes/stream.ts).
 * The first event is `meta` carrying the conversation id; `done` carries the
 * final response (without conversation_history — the server owns history).
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: {
    ask?: string;
    model?: string;
    agent_id?: string;
    conversation_id?: string;
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ask = body.ask?.trim();
  if (!ask) {
    return Response.json({ error: "`ask` is required" }, { status: 400 });
  }
  if (!body.agent_id) {
    return Response.json({ error: "`agent_id` is required" }, { status: 400 });
  }
  const model = body.model ?? DEFAULT_MODEL;

  let conversationId: string;
  let history: Awaited<ReturnType<typeof getReplayHistory>>;
  let agent: Awaited<ReturnType<typeof getAgent>>;
  try {
    agent = await getAgent(user.id, body.agent_id);
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    if (body.conversation_id) {
      const conversation = await getConversation(user.id, body.conversation_id);
      if (!conversation || conversation.agentId !== agent.id) {
        return Response.json(
          { error: "Conversation not found" },
          { status: 404 },
        );
      }
      conversationId = conversation.id;
      history = await getReplayHistory(conversationId);
    } else {
      conversationId = (
        await createConversation({ userId: user.id, agentId: agent.id, ask, model })
      ).id;
    }
    await addUserMessage(conversationId, ask);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return Response.json(
      {
        error: `Database unreachable (run \`docker compose up -d\` in drill/): ${detail.slice(0, 200)}`,
      },
      { status: 503 },
    );
  }

  // Knowledge integration (live only): inject the top similar resolutions
  // into the system prompt and let Holmes search deeper via the frontend
  // tool. Search failures must never block an investigation.
  const holmesReq: HolmesChatRequest = { ask, model, conversation_history: history };
  if (!fixtureMode()) {
    holmesReq.frontend_tools = [SEARCH_TOOL_DEF];
    try {
      const hits = (await searchArtifacts(ask, { limit: 3 })).filter(
        (h) => h.score >= RELEVANCE_FLOOR,
      );
      if (hits.length) {
        holmesReq.additional_system_prompt = buildInjectionPrompt(hits);
      }
    } catch {
      // knowledge base unavailable — investigate without it
    }
  }

  const encoder = new TextEncoder();
  const convId = conversationId;
  const target = { url: agent.url, apiKey: agent.apiKey };
  const started = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // If the client disconnects mid-investigation, keep consuming Holmes
      // and persist the result anyway — investigations are slow and costly.
      let clientGone = false;
      const send = (payload: unknown) => {
        if (clientGone) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          clientGone = true;
        }
      };
      send({ type: "meta", conversation_id: convId });
      const outcome: StreamOutcome = { response: null! };
      try {
        for await (const event of streamHolmes(holmesReq, outcome, target)) {
          send(event);
        }
        if (outcome.response) {
          await addAssistantMessage({
            conversationId: convId,
            response: outcome.response,
            model,
            durationMs: Date.now() - started,
          });
        }
      } catch (err) {
        send({
          type: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        });
      } finally {
        if (!clientGone) {
          try {
            controller.close();
          } catch {
            // already closed by cancellation
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
