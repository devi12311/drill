import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { openTurn } from "@/lib/db/chat-turn-queries";
import {
  createConversation,
  getAgent,
  getConversation,
  getPendingApproval,
  getReplayHistory,
} from "@/lib/db/queries";
import { fixtureMode } from "@/lib/holmes/stream";
import type {
  HolmesChatRequest,
  HolmesChatResponse,
  ToolApprovalDecision,
} from "@/lib/holmes/types";
import { servedModels } from "@/lib/holmes/validate";
import {
  buildInjectionPrompt,
  RELEVANCE_FLOOR,
  searchArtifacts,
  SEARCH_TOOL_DEF,
} from "@/lib/artifacts/search";

/** How a decision reads in the transcript (stored as the user's turn). */
function describeDecisions(
  paused: HolmesChatResponse,
  decisions: ToolApprovalDecision[],
): string {
  return decisions
    .map((d) => {
      const name =
        paused.pending_approvals?.find((a) => a.tool_call_id === d.tool_call_id)
          ?.tool_name ?? "tool";
      if (d.approved) return `Approved ${name}`;
      return d.feedback ? `Denied ${name}: ${d.feedback}` : `Denied ${name}`;
    })
    .join("\n");
}

/**
 * POST /api/chat — body: { ask, model?, agent_id, conversation_id? }, or
 * { tool_decisions, agent_id, conversation_id, model? } to answer a paused
 * tool approval (see lib/holmes/stream.ts).
 *
 * Queues the turn and returns at once — 202 { conversation_id, turn_id }. The
 * worker's chat lane runs the investigation (lib/chat/runner.ts) and the client
 * follows it on GET /api/chat/turns/[id]/events, so nothing about it depends on
 * this request, the browser tab, or the web pod staying up. 409 carries the
 * turn already running in the conversation, for the client to attach to.
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();

  let body: {
    ask?: string;
    model?: string;
    agent_id?: string;
    conversation_id?: string;
    tool_decisions?: ToolApprovalDecision[];
  };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const decisions = Array.isArray(body.tool_decisions)
    ? body.tool_decisions.map((d) => ({
        tool_call_id: String(d.tool_call_id),
        approved: d.approved === true,
        ...(d.approved !== true &&
          d.feedback?.trim() && { feedback: d.feedback.trim() }),
      }))
    : null;
  const ask = body.ask?.trim();
  if (!ask && !decisions?.length) {
    return Response.json({ error: "`ask` is required" }, { status: 400 });
  }
  if (decisions && !body.conversation_id) {
    return Response.json(
      { error: "`tool_decisions` needs a `conversation_id`" },
      { status: 400 },
    );
  }
  if (!body.agent_id) {
    return Response.json({ error: "`agent_id` is required" }, { status: 400 });
  }

  let model = body.model?.trim();
  let conversationId: string;
  let conversationTitle: string | null = null;
  let history: Awaited<ReturnType<typeof getReplayHistory>>;
  let paused: HolmesChatResponse | null = null;
  let agent: Awaited<ReturnType<typeof getAgent>>;
  try {
    agent = await getAgent(user.id, body.agent_id);
    if (!agent) {
      return Response.json({ error: "Agent not found" }, { status: 404 });
    }
    // No model given → the agent's default (first served). Drill keeps no
    // default of its own; it would outlive the agent's modelList.
    if (!model) {
      try {
        model = (await servedModels(agent.url, agent.apiKey))[0];
      } catch (err) {
        return Response.json(
          {
            error: `No model given and the agent could not list its models: ${err instanceof Error ? err.message : String(err)}`,
          },
          { status: 502 },
        );
      }
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
      conversationTitle = conversation.title;
      if (decisions) {
        paused = await getPendingApproval(conversationId);
        const pendingIds = new Set(
          paused?.pending_approvals?.map((a) => a.tool_call_id),
        );
        if (
          !paused ||
          decisions.length !== pendingIds.size ||
          !decisions.every((d) => pendingIds.has(d.tool_call_id))
        ) {
          return Response.json(
            { error: "No matching tool approval is pending in this conversation" },
            { status: 409 },
          );
        }
      } else {
        history = await getReplayHistory(conversationId);
      }
    } else {
      conversationId = (
        await createConversation({
          userId: user.id,
          agentId: agent.id,
          ask: ask!,
          model,
        })
      ).id;
    }
  } catch (err) {
    return databaseUnreachable(err);
  }

  // Knowledge integration (live only): inject the top similar resolutions
  // into the system prompt and let Holmes search deeper via the frontend
  // tool. Search failures must never block an investigation.
  // A decision resumes Holmes's paused history with no new user turn (empty
  // `ask`); knowledge injection only applies to a fresh question.
  const holmesReq: HolmesChatRequest = paused
    ? {
        ask: "",
        model,
        conversation_history: paused.conversation_history,
        tool_decisions: decisions!,
        ...(paused.drill_frontend_tool_results && {
          frontend_tool_results: paused.drill_frontend_tool_results,
        }),
      }
    : { ask: ask!, model, conversation_history: history };
  if (!fixtureMode()) {
    holmesReq.enable_tool_approval = true;
    holmesReq.frontend_tools = [SEARCH_TOOL_DEF];
  }
  if (!fixtureMode() && !paused) {
    try {
      const hits = (await searchArtifacts(ask!, { limit: 3 })).filter(
        (h) => h.score >= RELEVANCE_FLOOR,
      );
      if (hits.length) {
        holmesReq.additional_system_prompt = buildInjectionPrompt(hits);
      }
    } catch {
      // knowledge base unavailable — investigate without it
    }
  }

  const note = paused ? describeDecisions(paused, decisions!) : undefined;
  try {
    const result = await openTurn({
      conversationId,
      userId: user.id,
      agentId: agent.id,
      model,
      kind: paused ? "decision" : "ask",
      request: holmesReq,
      // A pause stored before `drill_question` existed falls back to the title,
      // which is the conversation's first question.
      question: paused
        ? (paused.drill_question ?? conversationTitle ?? "")
        : ask!,
      note,
      userLine: note ?? ask!,
    });
    if (!result.ok) {
      return Response.json(
        {
          error: "An investigation is already running in this conversation",
          conversation_id: conversationId,
          turn_id: result.activeTurnId,
        },
        { status: 409 },
      );
    }
    return Response.json(
      { conversation_id: conversationId, turn_id: result.turnId },
      { status: 202 },
    );
  } catch (err) {
    return databaseUnreachable(err);
  }
}

function databaseUnreachable(err: unknown) {
  const detail = err instanceof Error ? err.message : String(err);
  return Response.json(
    {
      error: `Database unreachable (run \`docker compose up -d\` in drill/): ${detail.slice(0, 200)}`,
    },
    { status: 503 },
  );
}
