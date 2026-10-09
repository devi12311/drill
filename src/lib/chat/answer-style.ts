/**
 * How Holmes words its final answer — the prompt that asks for a shape and the
 * parser that renders it, in one file so the two cannot drift. Client-safe: the
 * answer renderer and the org settings page import it too.
 *
 * Why it exists: Holmes's built-in prompt tells the model to keep digging past
 * the root cause and list every candidate (generic_ask.jinja2), which is right
 * for the investigation but turns the write-up into a diary. Drill already shows
 * the investigation in the tool rail, so the answer only has to say what is wrong
 * and what to do. The structure is code (the renderer depends on it); an org owns
 * only its default mode and its house rules.
 */

export const ANSWER_MODES = ["brief", "detailed"] as const;
export type AnswerMode = (typeof ANSWER_MODES)[number];

export const ANSWER_MODE_LABEL: Record<AnswerMode, string> = {
  brief: "Brief",
  detailed: "Detailed",
};

export const ANSWER_MODE_HINT: Record<AnswerMode, string> = {
  brief: "Problem, copy-paste fix and a verify command up top; the evidence folded below.",
  detailed: "Holmes's own full write-up of what it found.",
};

export function isAnswerMode(value: unknown): value is AnswerMode {
  return (ANSWER_MODES as readonly unknown[]).includes(value);
}

/** An org's answer settings — the only part of the answer style that is data. */
export interface AnswerStyle {
  answerMode: AnswerMode;
  answerRules: string | null;
}

/** Room for a handful of house rules; past this it is a skill, not a style. */
export const ANSWER_RULES_MAX = 2000;

/** Trimmed rules, null when empty. Throws past the limit. */
export function validateAnswerRules(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string") throw new Error("House rules must be text");
  const rules = raw.trim();
  if (rules.length > ANSWER_RULES_MAX)
    throw new Error(`House rules: at most ${ANSWER_RULES_MAX} characters`);
  return rules || null;
}

/** The headings the brief format asks for — and the renderer looks for. */
export const ANSWER_HEADINGS = {
  problem: "Problem",
  fix: "Fix",
  verify: "Verify",
  details: "Details",
} as const;
export type AnswerSectionKey = keyof typeof ANSWER_HEADINGS;

const H = ANSWER_HEADINGS;

/** The brief format, exactly as Holmes receives it (also shown on /org). */
export const BRIEF_FORMAT = `## Answer format (overrides any earlier guidance on how to write the answer)
Investigate as thoroughly as you need — this governs only the final answer. The answer is NOT a log of the investigation: the user already sees every tool call you made. Never narrate what you checked or in which order, and never mention hypotheses you ruled out.

When there is something to fix, answer with exactly these sections (the tags only mark the template — do not write them):
<answer_template>
### ${H.problem}
One or two sentences: what is wrong and where (namespace, resource, file).
### ${H.fix}
The change, copy-paste ready. Complete commands in \`\`\`bash blocks; a config change as a \`\`\`diff block or the full corrected snippet, naming the file or values path. Use the real names and values you found — no placeholders for anything you know.
### ${H.verify}
One command, and the output that means the fix worked.
## ${H.details}
At most three bullets with the decisive evidence. Then "Also noticed:" with one line per unrelated finding, if any. Add a \`\`\`mermaid diagram only when a topology or request path IS the explanation (10 nodes at most).
</answer_template>

If you are not confident in the cause, say so in ${H.problem}, name the two most likely candidates, and make ${H.fix} the single command that tells them apart.
If nothing needs fixing (a status check, an explanation, a list), answer directly in the shortest form that fits — no sections.
When you follow a skill, its required opening comes first, then this format. Keep resolution citations exactly as instructed.`;

/**
 * The block appended to Holmes's system prompt: the brief format (in brief mode)
 * and the org's house rules (in both). Null when there is nothing to add.
 */
export function answerStyleBlock(mode: AnswerMode, rules: string | null): string | null {
  const house = rules ? `## House rules for answers (always apply)\n\n${rules}` : null;
  return [mode === "brief" ? BRIEF_FORMAT : null, house].filter(Boolean).join("\n\n") || null;
}

// ---- Rendering side ----

export interface AnswerSection {
  key: AnswerSectionKey;
  body: string;
}

export interface SplitAnswer {
  /** Text before the first section, e.g. a skill's required opening. */
  lead: string;
  /** Problem / Fix / Verify, in the order the model wrote them. */
  sections: AnswerSection[];
  /** Everything from the Details heading on; null when there is none. */
  details: string | null;
}

const HEADING_KEY = new Map(
  (Object.entries(ANSWER_HEADINGS) as [AnswerSectionKey, string][]).map(([k, v]) => [
    v.toLowerCase(),
    k,
  ]),
);
const HEADING_LINE = /^#{2,3}\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * The brief format's sections, or null for any other answer (old messages,
 * detailed mode, a plain status reply) — those render as ordinary markdown.
 * Headings inside code fences are ignored, so a quoted snippet cannot split it.
 */
export function splitAnswer(markdown: string): SplitAnswer | null {
  const parts: { key: AnswerSectionKey | "lead"; lines: string[] }[] = [
    { key: "lead", lines: [] },
  ];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const opener = FENCE.exec(line)?.[1];
    if (opener && (fence === null || fence === opener)) fence = fence ? null : opener;
    const key = fence === null && HEADING_LINE.exec(line)?.[1];
    const section = key ? HEADING_KEY.get(key.replace(/[*_`:]/g, "").trim().toLowerCase()) : undefined;
    // Details swallows the rest: its own sub-headings stay inside the fold.
    const inDetails = parts.at(-1)!.key === "details";
    if (section && !inDetails && !parts.some((p) => p.key === section)) {
      parts.push({ key: section, lines: [] });
    } else {
      parts.at(-1)!.lines.push(line);
    }
  }
  if (parts.length === 1) return null;
  const text = (lines: string[]) => lines.join("\n").trim();
  const details = parts.find((p) => p.key === "details");
  return {
    lead: text(parts[0].lines),
    sections: parts
      .filter((p): p is { key: Exclude<AnswerSectionKey, "details">; lines: string[] } =>
        p.key !== "lead" && p.key !== "details",
      )
      .map((p) => ({ key: p.key, body: text(p.lines) })),
    details: details ? text(details.lines) : null,
  };
}
