import type { PendingToolApproval, ToolApprovalDecision } from "@/lib/holmes/types";

/**
 * Plain-language wording for why a chat turn stopped. The raw error is written for
 * whoever debugs the transport ("terminated: other side closed…"); the person who
 * asked the question needs to know what happened and what Resume will do. The raw
 * text stays one click away, under Details.
 *
 * Matches the error texts produced in lib/holmes/sse.ts and lib/chat/runner.ts.
 */

const RULES: { test: RegExp; headline: string; divider: string }[] = [
  {
    test: /Connection to Holmes dropped/,
    headline: "The connection to Holmes dropped before it answered.",
    divider: "Connection to Holmes lost",
  },
  {
    test: /did not finish within/,
    headline: "Holmes did not finish within the time limit.",
    divider: "Time limit reached",
  },
  {
    test: /Could not reach Holmes/,
    headline: "Drill could not reach the Holmes agent.",
    divider: "Holmes unreachable",
  },
  {
    test: /5204|rate.?limit|quota|429/i,
    headline: "The model provider is rate-limiting requests. Wait a minute, then resume.",
    divider: "Rate-limited",
  },
  {
    test: /worker restarted|worker running this stopped/,
    headline: "Drill restarted while Holmes was working.",
    divider: "Drill restarted",
  },
  {
    test: /^Stopped/,
    headline: "Stopped",
    divider: "Stopped, resumed by you",
  },
  {
    test: /agent for this conversation was deleted/,
    headline: "The Holmes agent this conversation used has been deleted.",
    divider: "Agent removed",
  },
  {
    test: /^Holmes error/,
    headline: "Holmes reported an error and stopped.",
    divider: "Holmes error",
  },
  {
    test: /^Holmes API \d/,
    headline: "Holmes rejected the request.",
    divider: "Holmes rejected the request",
  },
];

function rule(error: string | null | undefined) {
  return error ? RULES.find((r) => r.test.test(error)) : undefined;
}

export function turnErrorHeadline(error: string | null): string {
  return rule(error)?.headline ?? "The investigation stopped unexpectedly.";
}

/** For the divider where a resumed attempt begins. */
export function interruptionLabel(reason: string | undefined): string {
  return rule(reason)?.divider ?? "Interrupted";
}

/** One answered approval, as the transcript shows it. */
export interface DecisionView {
  tool_name: string;
  description: string;
  approved: boolean;
  feedback?: string;
}

/**
 * How a decision reads in the transcript — stored as the user's line of the turn,
 * so it is also what `parseDecisions` reads back.
 */
export function describeDecisions(
  approvals: readonly PendingToolApproval[] | null | undefined,
  decisions: readonly ToolApprovalDecision[],
): string {
  return decisions
    .map((d) => {
      const name =
        approvals?.find((a) => a.tool_call_id === d.tool_call_id)?.tool_name ??
        "tool";
      if (d.approved) return `Approved ${name}`;
      return d.feedback ? `Denied ${name}: ${d.feedback}` : `Denied ${name}`;
    })
    .join("\n");
}

/**
 * The stored decision line back into one verdict per paused call, in order — or
 * null when the line is not a decision: someone may type a new question instead
 * of answering the pause. Split only where a verdict starts, so feedback may span
 * lines.
 */
export function parseDecisions(
  line: string,
  approvals: readonly PendingToolApproval[],
): DecisionView[] | null {
  const verdicts = line.split(/\n(?=(?:Approved|Denied) )/);
  if (approvals.length === 0 || verdicts.length !== approvals.length) return null;
  const parsed: DecisionView[] = [];
  for (const [i, a] of approvals.entries()) {
    const verdict = verdicts[i];
    // describeDecisions writes "tool" when it could not name the call.
    const named = [a.tool_name, "tool"].some(
      (name) => verdict === `Approved ${name}` || verdict === `Denied ${name}` || verdict.startsWith(`Denied ${name}: `),
    );
    if (!named) return null;
    const feedback = verdict.startsWith("Denied ") ? verdict.split(": ").slice(1).join(": ") : "";
    parsed.push({
      tool_name: a.tool_name,
      description: a.description,
      approved: verdict.startsWith("Approved "),
      ...(feedback ? { feedback } : {}),
    });
  }
  return parsed;
}
