import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { getAgent, getConversation, getConversationMessages } from "@/lib/db/queries";
import { usableSkills } from "@/lib/db/skill-queries";
import { fixtureMode } from "@/lib/holmes/stream";
import type { HolmesChatResponse } from "@/lib/holmes/types";
import { draftSkill } from "@/lib/skills/draft";
import {
  askedQuestions,
  MAX_SKILL_STEPS,
  PURPOSE_LIMIT,
  conversationCalls,
  isAddableStep,
} from "@/lib/skills/conversation-steps";
import {
  conversationSource,
  fixtureDraft,
  inputsCheck,
  type GivenInput,
} from "@/lib/skills/from-conversation";
import { SKILL_LIMITS, checkInput, validateSkillDraft } from "@/lib/skills/types";

// A real Holmes call writing a whole procedure — allow the time.
export const maxDuration = 300;

type Context = { params: Promise<{ id: string }> };

class BadRequest extends Error {}

function parseInputs(raw: unknown): GivenInput[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new BadRequest("inputs must be an array");
  if (raw.length > SKILL_LIMITS.inputs)
    throw new BadRequest(`a skill can have at most ${SKILL_LIMITS.inputs} inputs`);
  const seen = new Set<string>();
  return raw.map((item, i) => {
    let input;
    try {
      input = checkInput(item, i, seen);
    } catch (err) {
      throw new BadRequest(err instanceof Error ? err.message : "invalid input");
    }
    const value = (item as { value?: unknown }).value;
    if (value !== undefined && typeof value !== "string")
      throw new BadRequest(`input ${input.key}: value must be text`);
    const trimmed = value?.trim() ?? "";
    if (trimmed.length > SKILL_LIMITS.inputValue)
      throw new BadRequest(`input ${input.key}: value is too long`);
    // An input this conversation had a value for was there from the start.
    return { ...input, required: input.required || trimmed !== "", value: trimmed || undefined };
  });
}

/**
 * POST /api/conversations/[id]/skill-draft — body: { steps, inputs, purpose }.
 * Drafts a skill from the calls the author picked in this conversation. Steps
 * arrive as keys and are resolved here from the stored messages, so the prompt
 * only ever carries what Holmes actually ran. Nothing is saved: the skill editor
 * shows the draft for review.
 */
export async function POST(request: Request, context: Context) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;

  let steps: string[];
  let inputs: GivenInput[];
  let purpose: string;
  try {
    const body = (await request.json().catch(() => {
      throw new BadRequest("Invalid JSON body");
    })) as { steps?: unknown; inputs?: unknown; purpose?: unknown };
    if (!Array.isArray(body.steps) || !body.steps.every((s) => typeof s === "string"))
      throw new BadRequest("steps must be a list of step keys");
    steps = [...new Set(body.steps as string[])];
    if (steps.length === 0) throw new BadRequest("Pick at least one step");
    if (steps.length > MAX_SKILL_STEPS)
      throw new BadRequest(`Pick at most ${MAX_SKILL_STEPS} steps`);
    purpose = typeof body.purpose === "string" ? body.purpose.trim() : "";
    if (!purpose) throw new BadRequest("Say what the skill is for");
    if (purpose.length > PURPOSE_LIMIT)
      throw new BadRequest(`Keep the purpose under ${PURPOSE_LIMIT} characters`);
    inputs = parseInputs(body.inputs);
  } catch (err) {
    if (err instanceof BadRequest) return Response.json({ error: err.message }, { status: 400 });
    throw err;
  }

  const conversation = await getConversation(ctx, id);
  const rows = conversation && (await getConversationMessages(ctx, id));
  if (!conversation || !rows)
    return Response.json({ error: "Conversation not found" }, { status: 404 });

  const calls = new Map(
    conversationCalls(
      rows
        .filter((r) => r.role === "assistant")
        .map((r) => ({
          id: r.id,
          toolCalls: (r.rawResponse as HolmesChatResponse | null)?.tool_calls ?? [],
        })),
    ).map((c) => [c.key, c]),
  );
  const resolved = [];
  for (const key of steps) {
    const step = calls.get(key);
    if (!step)
      return Response.json({ error: "A picked step is not in this conversation" }, { status: 422 });
    if (!isAddableStep(step.call))
      return Response.json(
        { error: `${step.call.tool_name} runs on its own and cannot be a step` },
        { status: 400 },
      );
    resolved.push(step);
  }
  const picked = resolved
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({ number: i + 1, call: s.call }));

  try {
    if (fixtureMode())
      return Response.json({ draft: validateSkillDraft(fixtureDraft(purpose, picked, inputs)) });

    const agent = await getAgent(ctx.orgId, conversation.agentId);
    if (!agent) return Response.json({ error: "Agent not found" }, { status: 404 });
    const existing = (await usableSkills(ctx)).map((s) => ({
      name: s.name,
      description: s.description,
    }));
    const draft = await draftSkill(
      { url: agent.url, apiKey: agent.apiKey },
      conversation.model,
      {
        source: conversationSource({
          purpose,
          questions: askedQuestions(
            rows.map((r) => ({
              role: r.role,
              text: r.content,
              pendingApprovals: (r.rawResponse as HolmesChatResponse | null)?.pending_approvals,
              skillRun: r.skill !== null,
            })),
          ).map((q) => q.text),
          analyses: rows.filter((r) => r.role === "assistant" && r.content).map((r) => r.content),
          steps: picked,
          inputs,
        }),
        current: null,
        existing,
        check: inputsCheck(inputs),
      },
      request.signal,
    );
    return Response.json({ draft });
  } catch (err) {
    const message = err instanceof Error ? err.message : "drafting failed";
    return Response.json(
      { error: `Holmes could not draft the skill: ${message}` },
      { status: 502 },
    );
  }
}
