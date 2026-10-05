import { renderTemplate } from "@/lib/templates";
import type { SkillInput } from "./types";

/**
 * Every piece of skill text Holmes sees. Kept in one file so the catalog, the
 * fetched form and the explicitly-run form cannot drift apart.
 */

export const FETCH_SKILL_TOOL_NAME = "drill_fetch_skill";

/** Past this, the catalog's per-turn cost outgrows its use; shared ones win. */
const CATALOG_LIMIT = 50;

interface PromptSkill {
  name: string;
  description: string;
  body: string;
  inputs: SkillInput[];
}

/**
 * The model's selection list. Mirrors Holmes's own "# Skill Selection" block
 * (base_user_prompt.jinja2) — selection by description, no speculative fetches —
 * but names Drill's tool, since Holmes's `fetch_skill` cannot see these.
 */
export function catalogBlock(skills: readonly Pick<PromptSkill, "name" | "description">[]): string {
  const lines = skills
    .slice(0, CATALOG_LIMIT)
    .map((s) => `* ${s.name} | description: ${s.description.replace(/\s+/g, " ")}`);
  return `## Drill skills — step-by-step procedures for this infrastructure

${lines.join("\n")}

If one of these skills clearly matches the user's issue, fetch it with the ${FETCH_SKILL_TOOL_NAME} tool before diving into other tools, then follow its steps — skill content takes priority over general investigation steps. Only fetch skills that clearly match; never fetch speculatively. If a step needs a tool you do not have, say that you could not perform it and why.`;
}

/**
 * Shared skills an admin marked always-on: standing team instructions. Each body
 * is fenced in a tag — its own markdown headings would otherwise read as peers of
 * the sections around it.
 */
export function alwaysOnBlock(skills: readonly Pick<PromptSkill, "name" | "body">[]): string {
  const bodies = skills.map((s) => `<instructions name="${s.name}">\n${s.body}\n</instructions>`);
  return `## Team instructions (always apply)

${bodies.join("\n\n")}`;
}

/**
 * The fetched/run form. Same contract as Holmes's own fetch_skill result
 * (skills_fetcher.py): directions, not results, and an answer that opens by
 * naming the skill with a ✅/❌ per step — which is also what lets a reader see
 * a skill was followed. Holmes's ten-line worked example is cut to two lines:
 * it is paid for on every fetch, and the format needs no more.
 */
function wrapSkill(name: string, body: string): string {
  return `<skill name="${name}">
${body}
</skill>
Note: the above are DIRECTIONS, not ACTUAL RESULTS. Anything in the skill that looks like a result is only an EXAMPLE. Follow the steps yourself by CALLING TOOLS, then report back what you found.

Assuming the skill is relevant, start your response (after investigating) with:
"I found a skill named **${name}** and used it to troubleshoot:"
then list each step with ✅ for completed steps and ❌ for steps you could not complete (say why — e.g. which tool is missing).
For example:
1. ✅ *Look up the integration* — type snapchat, user 1042
2. ❌ *Find the cost span* — no span in Tempo for the window (spans expire after ~1 day)`;
}

/**
 * The form `drill_fetch_skill` returns. Nobody filled the inputs in, so each
 * `{{key}}` becomes a visible `<key>` slot the model takes from the request.
 */
export function renderFetched(skill: PromptSkill): string {
  const slots = Object.fromEntries(skill.inputs.map((i) => [i.key, `<${i.key}>`]));
  const body = renderTemplate(skill.body, slots);
  const legend = skill.inputs.length
    ? `\n\nValues marked <…> come from the user's request: ${skill.inputs
        .map((i) => `<${i.key}> = ${i.label}${i.required ? "" : " (optional)"}`)
        .join("; ")}. Ask for a required one only if the request does not give it.`
    : "";
  return wrapSkill(skill.name, body + legend);
}

/**
 * An explicit run: the user picked the skill, so there is no selection step —
 * the procedure arrives already rendered with their inputs, ahead of any extra
 * context they typed.
 */
export function renderInvocation(
  skill: PromptSkill,
  values: Readonly<Record<string, string>>,
  note: string,
): string {
  const given = skill.inputs
    .filter((i) => values[i.key])
    .map((i) => `- ${i.label} (${i.key}): ${values[i.key]}`);
  return [
    `Run the skill "${skill.name}" for this request.`,
    given.length ? `Inputs:\n${given.join("\n")}` : null,
    note ? `Additional context from the user:\n${note}` : null,
    wrapSkill(skill.name, renderTemplate(skill.body, values)),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The transcript line for an explicit run — the procedure itself stays out of it. */
export function invocationLine(
  skill: Pick<PromptSkill, "name" | "inputs">,
  values: Readonly<Record<string, string>>,
  note: string,
): string {
  const args = skill.inputs
    .filter((i) => values[i.key])
    // Quoted when it has spaces, so the line parses back (parseInvocationLine).
    .map((i) => `${i.key}=${/\s/.test(values[i.key]) ? `"${values[i.key]}"` : values[i.key]}`)
    .join(" ");
  return [`/${skill.name}${args ? ` ${args}` : ""}`, note].filter(Boolean).join("\n");
}

/**
 * The inverse of `invocationLine`: `/name key=value key="two words"` on the first
 * line, anything after the recognised inputs is the note. Null when the text is
 * not a command for one of `skills`. Keys that are not the skill's inputs stay in
 * the note rather than vanishing.
 */
export function parseInvocationLine<S extends Pick<PromptSkill, "name" | "inputs">>(
  text: string,
  skills: readonly S[],
): { skill: S; values: Record<string, string>; note: string } | null {
  const match = text.trim().match(/^\/([a-z0-9-]+)(?:[ \t]+([^\n]*))?(?:\n([\s\S]*))?$/);
  const skill = match && skills.find((s) => s.name === match[1]);
  if (!match || !skill) return null;
  const keys = new Set(skill.inputs.map((i) => i.key));
  const values: Record<string, string> = {};
  const rest: string[] = [];
  for (const [token, key, quoted, bare] of (match[2] ?? "").matchAll(
    /([a-z][a-z0-9_]*)=(?:"([^"]*)"|(\S+))|\S+/g,
  )) {
    if (key && keys.has(key)) values[key] = (quoted ?? bare ?? "").trim();
    else rest.push(token);
  }
  const note = [rest.join(" "), match[3]?.trim() ?? ""].filter(Boolean).join("\n");
  return { skill, values, note };
}
