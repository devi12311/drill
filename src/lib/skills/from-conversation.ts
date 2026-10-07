import "server-only";
import type { ToolCall } from "@/lib/holmes/types";
import { containsValue, paramPreview, templateValues } from "./conversation-steps";
import type { SkillDraft, SkillInput } from "./types";

/**
 * The prompt section for a skill drafted from a conversation: the steps the
 * author picked, in conversation order, as the workflow's spine. Every value the
 * author made an input is already `{{key}}` in everything sent, so the model
 * works from the template rather than being trusted to find each occurrence —
 * `inputsCheck` then catches any it still copied from elsewhere.
 */

/** An input the author confirmed; `value` is what this conversation used, if any. */
export interface GivenInput extends SkillInput {
  value?: string;
}

export interface PickedStep {
  number: number;
  call: ToolCall;
}

/** Same budget as artifact distillation: about what one prompt section should cost. */
const BUDGET_CHARS = 48_000;

/** Caps tried in order until the section fits — analyses go first, steps never. */
const TIERS = [
  { analysis: 600, output: 1500, params: 2000 },
  { analysis: 200, output: 1500, params: 2000 },
  { analysis: 0, output: 600, params: 2000 },
  { analysis: 0, output: 200, params: 800 },
  { analysis: 0, output: 0, params: 400 },
] as const;

function cut(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** `toolset/tool`, or just the tool — Holmes leaves `toolset_name` empty on its own calls. */
function toolLabel(call: ToolCall): string {
  return call.toolset_name ? `${call.toolset_name}/${call.tool_name}` : call.tool_name;
}

function stepBlock(
  { number, call }: PickedStep,
  caps: (typeof TIERS)[number],
  inputs: readonly GivenInput[],
): string {
  const params = templateValues(paramPreview(call), inputs);
  const output = templateValues(call.result.data ?? call.result.error ?? "", inputs);
  return [
    `${number}. ${toolLabel(call)} — ${templateValues(call.description, inputs)}`,
    `   params: ${params ? cut(params, caps.params) : "(none)"}`,
    `   status: ${call.result.status}`,
    caps.output > 0 && output ? `   output (excerpt): ${cut(output, caps.output)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function conversationSource(input: {
  purpose: string;
  questions: readonly string[];
  analyses: readonly string[];
  steps: readonly PickedStep[];
  inputs: readonly GivenInput[];
}): string {
  const t = (text: string) => templateValues(text, input.inputs);
  const inputLines = input.inputs.length
    ? input.inputs
        .map((i) => `- {{${i.key}}} — ${i.label}${i.value ? " (already substituted below)" : ""}`)
        .join("\n")
    : "(none — add one only if a step needs a value that changes per run)";

  const render = (caps: (typeof TIERS)[number]) =>
    `WHAT THE SKILL IS FOR
${t(input.purpose)}

INPUTS THE AUTHOR CHOSE — declare every one, with these keys:
${inputLines}

INVESTIGATION IT COMES FROM — the questions asked, in order:
${input.questions.map((q, i) => `Q${i + 1}: ${t(q)}`).join("\n")}
${
  caps.analysis > 0 && input.analyses.length
    ? `\nWhat was concluded:\n${input.analyses.map((a) => `- ${cut(t(a), caps.analysis)}`).join("\n")}\n`
    : ""
}
STEPS THE AUTHOR PICKED — the calls that actually moved the investigation, in the order they ran:
${input.steps.map((s) => stepBlock(s, caps, input.inputs)).join("\n\n")}

HOW TO TURN THIS INTO THE SKILL
- The Workflow follows the picked steps in this order, one workflow step per picked step. Each names the exact toolset/tool above and reuses its params as a template, keeping the {{key}} placeholders.
- For each step, say what in its result moves the investigation on (from the excerpts and conclusions above), and what to do when it shows nothing.
- Add a "## Known facts" section after Inputs: the tables, columns, repositories, services and selectors these steps relied on, so they are never rediscovered.
- Generalise: nothing specific to this one incident except through inputs. Absolute dates and times become relative windows ("the last 24 hours") or an input.
- Copy no values out of the outputs except identifiers of systems (table, service, repo names), and never a secret, token or credential.
- These tools and params already ran in this deployment — no lookups are needed to confirm them.`;

  for (const caps of TIERS) {
    const text = render(caps);
    if (text.length <= BUDGET_CHARS) return text;
  }
  return render(TIERS[TIERS.length - 1]);
}

/**
 * The draft must declare every input the author chose and must not still carry
 * one of their values literally — that would bake this incident into the skill.
 */
export function inputsCheck(inputs: readonly GivenInput[]) {
  return (draft: SkillDraft) => {
    const declared = new Set(draft.inputs.map((i) => i.key));
    const missing = inputs.filter((i) => !declared.has(i.key)).map((i) => i.key);
    if (missing.length)
      throw new Error(`declare these inputs: ${missing.join(", ")}`);
    for (const i of inputs) {
      if (i.value && (containsValue(draft.body, i.value) || containsValue(draft.description, i.value)))
        throw new Error(
          `"${i.value}" still appears literally — use {{${i.key}}} everywhere instead`,
        );
    }
  };
}

/** What `HOLMES_FIXTURE=1` answers: the picked steps, mechanically, so the UI runs offline. */
export function fixtureDraft(
  purpose: string,
  steps: readonly PickedStep[],
  inputs: readonly GivenInput[],
): SkillDraft {
  const t = (text: string) => templateValues(text, inputs);
  const workflow = steps
    .map(
      ({ call }, i) =>
        `${i + 1}. **${t(call.description) || call.tool_name}** (\`${toolLabel(call)}\`)\n   params: \`${cut(t(paramPreview(call)), 200).replace(/`/g, "'")}\``,
    )
    .join("\n");
  return {
    name: "fixture-skill-from-conversation",
    description: cut(`Fixture draft: ${t(purpose)}`, 400),
    inputs: inputs.map(({ key, label, required }) => ({ key, label, required })),
    body: `## Goal\n${t(purpose)}\n\n## Inputs\n${inputs.map((i) => `- ${i.key}: {{${i.key}}}`).join("\n") || "(none)"}\n\n## Workflow (follow in order)\n${workflow}\n\n## Synthesize findings\nState the root cause with evidence.\n\n## Recommended remediation\nPer outcome.`,
  };
}
