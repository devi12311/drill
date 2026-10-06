import { getAuthContext, unauthorized } from "@/lib/auth/session";
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
import { buildHolmesExtras } from "@/lib/chat/extras";
import { getUsableSkill } from "@/lib/db/skill-queries";
import { invocationLine, renderInvocation } from "@/lib/skills/prompt";
import { validateSkillValues, type MessageSkill } from "@/lib/skills/types";

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
 * { skill: { id, inputs }, ask?, … } to run a skill explicitly (`ask` is then
 * optional extra context), or { tool_decisions, agent_id, conversation_id,
 * model? } to answer a paused tool approval (see lib/holmes/stream.ts).
 *
 * Queues the turn and returns at once — 202 { conversation_id, turn_id }. The
 * worker's chat lane runs the investigation (lib/chat/runner.ts) and the client
 * follows it on GET /api/chat/turns/[id]/events, so nothing about it depends on
 * this request, the browser tab, or the web pod staying up. 409 carries the
 * turn already running in the conversation, for the client to attach to.
 */
export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  let body: {
    ask?: string;
    model?: string;
    agent_id?: string;
    conversation_id?: string;
    tool_decisions?: ToolApprovalDecision[];
    skill?: { id?: string; inputs?: Record<string, unknown> };
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
  const typed = body.ask?.trim() ?? "";
  const skillId = !decisions && body.skill?.id ? String(body.skill.id) : null;
  if (!typed && !skillId && !decisions?.length) {
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

  // An explicit run sends the rendered procedure to Holmes, while the transcript
  // (and a new conversation's title) shows only the command-like line.
  let ask = typed;
  let userLine = typed;
  let messageSkill: MessageSkill | null = null;
  if (skillId) {
    let skill;
    try {
      skill = await getUsableSkill(ctx, { id: skillId });
    } catch (err) {
      return databaseUnreachable(err);
    }
    if (!skill) {
      return Response.json({ error: "Skill not found" }, { status: 404 });
    }
    try {
      const values = validateSkillValues(skill, body.skill?.inputs);
      ask = renderInvocation(skill, values, typed);
      userLine = invocationLine(skill, values, typed);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Invalid skill inputs" },
        { status: 400 },
      );
    }
    messageSkill = { id: skill.id, name: skill.name };
  }

  let model = body.model?.trim();
  let conversationId: string;
  let conversationTitle: string | null = null;
  let history: Awaited<ReturnType<typeof getReplayHistory>>;
  let paused: HolmesChatResponse | null = null;
  let agent: Awaited<ReturnType<typeof getAgent>>;
  try {
    agent = await getAgent(ctx.orgId, body.agent_id);
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
      const conversation = await getConversation(ctx, body.conversation_id);
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
        await createConversation(ctx, { agentId: agent.id, ask: userLine, model })
      ).id;
    }
  } catch (err) {
    return databaseUnreachable(err);
  }

  // A decision resumes Holmes's paused history with no new user turn (empty
  // `ask`). Drill's tools and system prompt are live-only (lib/chat/extras.ts).
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
    : { ask, model, conversation_history: history };
  if (!fixtureMode()) {
    Object.assign(
      holmesReq,
      // The typed text, not the rendered skill: past resolutions are matched on
      // what the user described.
      await buildHolmesExtras({ ask: paused ? null : typed || userLine, scope: ctx }),
    );
  }

  const note = paused ? describeDecisions(paused, decisions!) : undefined;
  try {
    const result = await openTurn({
      scope: ctx,
      conversationId,
      agentId: agent.id,
      model,
      kind: paused ? "decision" : "ask",
      request: holmesReq,
      // A pause stored before `drill_question` existed falls back to the title,
      // which is the conversation's first question.
      question: paused
        ? (paused.drill_question ?? conversationTitle ?? "")
        : ask,
      note,
      userLine: note ?? userLine,
      skill: messageSkill,
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
