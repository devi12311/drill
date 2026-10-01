import type {
  ConversationMessage,
  HolmesChatRequest,
  ToolCall,
} from "@/lib/holmes/types";

/**
 * Rebuilding an interrupted chat turn from the evidence Drill saved.
 *
 * Holmes hands out its own conversation state only at a pause or with the final
 * answer, never mid-stream — so when a stream drops, the tool results Drill wrote
 * down as they arrived are all there is to continue from. The resume is a fresh
 * request: the last COMPLETE history (one that does not end in an unanswered tool
 * call), and an ask carrying the original question plus those results, so the
 * model picks up from the evidence instead of re-running twenty tool calls.
 */

/** Per-result cap: enough for the model to reason on, small enough to fit many. */
const RESULT_CHARS = 6_000;
/** Total evidence cap; past it, calls are listed by name and description only. */
const EVIDENCE_CHARS = 120_000;

function resultText(call: ToolCall): string {
  const r = call.result;
  const body = r?.data ?? r?.error ?? "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text.length > RESULT_CHARS
    ? `${text.slice(0, RESULT_CHARS)}\n…[truncated, ${text.length - RESULT_CHARS} more characters]`
    : text;
}

/** TodoWrite is Holmes's own plan, not evidence; it re-plans on its own. */
function isEvidence(call: ToolCall): boolean {
  return call.tool_name !== "TodoWrite";
}

export function buildEvidence(toolCalls: readonly ToolCall[]): string {
  const calls = toolCalls.filter(isEvidence);
  let budget = EVIDENCE_CHARS;
  return calls
    .map((call, i) => {
      const head = `### ${i + 1}. ${call.tool_name} — ${call.description || "(no description)"} [${call.result?.status ?? "unknown"}]`;
      const body = resultText(call);
      if (budget - body.length < 0) return `${head}\n(result omitted for length)`;
      budget -= body.length;
      return `${head}\n${body}`;
    })
    .join("\n\n");
}

export function buildResumeRequest(input: {
  /** The turn's request as first sent: model, system prompt, tools, approval mode. */
  original: HolmesChatRequest;
  question: string;
  /** The user's tool-approval decisions, when the turn was one. */
  decisionNote?: string | null;
  /** Calls made before this turn in the same paused chain, then this turn's own. */
  toolCalls: readonly ToolCall[];
  /** The last complete history — never a paused one (see `resumeContext`). */
  history: ConversationMessage[] | undefined;
}): HolmesChatRequest {
  const { original, question, decisionNote, toolCalls, history } = input;
  const evidence = buildEvidence(toolCalls);
  const ask = [
    "[Resuming an interrupted investigation] The connection to the previous attempt was lost before it answered. Continue it; do not start over.",
    `Original question:\n${question}`,
    decisionNote
      ? `The user's decisions on the tools that needed approval:\n${decisionNote}\nA tool listed below has already run. Never re-run a command that changes anything; request approval again only for an approved tool that does not appear below.`
      : null,
    evidence
      ? `Tool calls already executed, with their results. Use them as evidence and do not repeat them unless the data may have changed since:\n\n${evidence}`
      : "No tool call had completed yet.",
    "Now continue the investigation where it stopped and give the final answer.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    ask,
    model: original.model,
    conversation_history: history,
    additional_system_prompt: original.additional_system_prompt,
    frontend_tools: original.frontend_tools,
    enable_tool_approval: original.enable_tool_approval,
    // Deliberately NOT carried over: tool_decisions and frontend_tool_results
    // belong to the paused history this request no longer uses — replaying an
    // approval could run a destructive command a second time.
  };
}
