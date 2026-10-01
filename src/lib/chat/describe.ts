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
