import "server-only";
import { completeHolmesChat, type AgentTarget } from "@/lib/holmes/sse";
import { SKILL_LIMITS, validateSkillDraft, type SkillDraft } from "./types";

/**
 * Drafting a skill with Holmes. Holmes rather than a bare model, because its
 * system prompt already describes this deployment's toolsets — so the draft can
 * name its real toolsets (`kubernetes/logs`, a database toolset) instead of inventing tools. Nothing is saved:
 * the draft fills the editor, and the author reviews it before saving.
 */

const DRAFT_TIMEOUT_MS = 240_000;

const SKILL_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "skill_draft",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["name", "description", "inputs", "body"],
      properties: {
        name: {
          type: "string",
          description: "Lowercase slug of letters, digits and hyphens, 3-64 chars, e.g. checkout-latency-investigation",
        },
        description: {
          type: "string",
          description: `When to use the skill: the symptom and the inputs it starts from. At most ${SKILL_LIMITS.description} characters.`,
        },
        inputs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "label", "required"],
            properties: {
              key: { type: "string", description: "snake_case, e.g. service_name" },
              label: { type: "string", description: "Human label, e.g. Service name" },
              required: { type: "boolean" },
            },
          },
        },
        body: {
          type: "string",
          description: "The procedure in markdown; references inputs as {{key}}",
        },
      },
    },
  },
} as const;

/** No planning widget for a one-shot authoring task (same as monitoring's fast mode). */
const BEHAVIOR = { todowrite_instructions: false, todowrite_reminder: false };

function prompt(input: {
  request: string;
  current: SkillDraft | null;
  existing: readonly { name: string; description: string }[];
}): string {
  const existing = input.existing.length
    ? input.existing.map((s) => `- ${s.name}: ${s.description}`).join("\n")
    : "(none)";
  const current = input.current
    ? `\nCURRENT DRAFT — revise it according to the request instead of starting over:\n${JSON.stringify(input.current, null, 2)}\n`
    : "";
  return `You are writing a SKILL: a step-by-step procedure that you (Holmes) will later follow when investigating this infrastructure. Do NOT investigate anything now — you are only authoring the procedure.

WHAT THE AUTHOR WANTS
${input.request}
${current}
HOW TO WRITE IT
- Use the toolsets you actually have in this deployment and name them exactly (e.g. \`kubernetes/logs\`, \`prometheus/metrics\`, or a database toolset). Never invent a toolset; if a step needs one you lack, say so in the step.
- You MAY make at most 3 read-only tool calls, and only to confirm an exact name the procedure depends on (a collection, a service, a span name). Never run anything that changes state.
- Inputs are the values a person supplies when running the skill (ids, dates). Reference each one in the body as {{key}} — only declared keys; no other double braces anywhere in the body.
- Body structure, in markdown:
  ## Goal — the question the procedure answers and the possible outcomes.
  ## Inputs — each input and what it means.
  ## Workflow (follow in order) — numbered steps; each names the toolset/tool, what to look for, and how the result decides the next step.
  ## Synthesize findings — what the final answer must state, with evidence.
  ## Recommended remediation — what to do per outcome.
- Keep it under ~120 lines. Concrete beats generic: exact collection/field/span names where known.
- The description decides when the skill gets picked from the catalogue: name the symptom and the inputs; make it specific so it is not fetched for unrelated problems.
- Choose a name that does not clash with these existing skills (you may refer to them in steps):
${existing}

Return ONLY the JSON object matching the schema.`;
}

/**
 * One draft from the user's agent, validated with the same rules as a save —
 * and retried once with the validation error, which is usually a placeholder or
 * slug the model got slightly wrong.
 */
export async function draftSkill(
  agent: AgentTarget,
  model: string,
  input: Parameters<typeof prompt>[0],
  /** The author cancelled, or closed the page — stop paying for the answer. */
  abort?: AbortSignal,
): Promise<SkillDraft> {
  const ask = prompt(input);
  const answer = async (text: string) =>
    (
      await completeHolmesChat(
        agent,
        { ask: text, model, response_format: SKILL_RESPONSE_FORMAT, behavior_controls: BEHAVIOR },
        DRAFT_TIMEOUT_MS,
        [],
        abort,
      )
    ).analysis;
  const parse = (text: string) => validateSkillDraft(JSON.parse(text));
  // Only a malformed draft is retried; a timeout or a dead agent is not worth
  // paying for twice.
  const first = await answer(ask);
  try {
    return parse(first);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return parse(
      await answer(`${ask}\n\nYour previous answer was rejected: ${why}\nFix that and return ONLY the JSON object.`),
    );
  }
}
