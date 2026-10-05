import { assertPlaceholders, placeholdersIn } from "@/lib/templates";

/**
 * Skills: step-by-step procedures Holmes follows, authored in Drill instead of
 * the Holmes Helm values (docs/DECISIONS.md — "Drill owns skills"). Client-safe:
 * the editor validates against the very rules the API enforces.
 */

export const SKILL_VISIBILITIES = ["private", "shared"] as const;
export type SkillVisibility = (typeof SKILL_VISIBILITIES)[number];

/** A value the person running the skill fills in; the body uses it as `{{key}}`. */
export interface SkillInput {
  key: string;
  label: string;
  required: boolean;
}

/** A skill as the API returns it. */
export interface SkillView {
  id: string;
  name: string;
  description: string;
  body: string;
  inputs: SkillInput[];
  visibility: SkillVisibility;
  alwaysOn: boolean;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: string;
  /** Whether the requesting user may change it (computed per request). */
  editable: boolean;
}

/** The fields an author edits. */
export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  inputs: SkillInput[];
}

/** What the message records when a skill was run explicitly. */
export interface MessageSkill {
  id: string;
  name: string;
}

export const SKILL_LIMITS = {
  description: 400,
  body: 16_000,
  inputs: 10,
  label: 80,
  inputValue: 500,
} as const;

/**
 * Lowercase slug: it is what the model sees in the catalog and passes back to
 * `drill_fetch_skill`, so it has to survive being typed by a model.
 */
const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const INPUT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

function text(raw: unknown, field: string, max: number): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error(`${field} is required`);
  if (value.length > max)
    throw new Error(`${field} must be at most ${max} characters`);
  return value;
}

function checkName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!SKILL_NAME_PATTERN.test(name))
    throw new Error(
      "name must be 3–64 lowercase letters, digits or hyphens (e.g. cost-problems-investigation)",
    );
  return name;
}

function checkInput(item: unknown, i: number, seen: Set<string>): SkillInput {
  const entry = (item ?? {}) as Record<string, unknown>;
  const key = typeof entry.key === "string" ? entry.key.trim() : "";
  if (!INPUT_KEY_PATTERN.test(key))
    throw new Error(
      `input ${i + 1}: key must be lowercase letters, digits and _ (e.g. integration_id)`,
    );
  if (seen.has(key)) throw new Error(`input key "${key}" is used twice`);
  seen.add(key);
  return {
    key,
    label: text(entry.label ?? key, `input ${key} label`, SKILL_LIMITS.label),
    required: entry.required === true,
  };
}

function inputs(raw: unknown): SkillInput[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("inputs must be an array");
  if (raw.length > SKILL_LIMITS.inputs)
    throw new Error(`a skill can have at most ${SKILL_LIMITS.inputs} inputs`);
  const seen = new Set<string>();
  return raw.map((item, i) => checkInput(item, i, seen));
}

function checkBody(raw: unknown, keys: readonly string[]): string {
  const body = text(raw, "body", SKILL_LIMITS.body);
  assertPlaceholders(body, keys, "body");
  return body;
}

/** Validate an author's draft; throws with a message fit for a 400. */
export function validateSkillDraft(raw: unknown): SkillDraft {
  const input = (raw ?? {}) as Record<string, unknown>;
  const name = checkName(input.name);
  const description = text(input.description, "description", SKILL_LIMITS.description);
  const checkedInputs = inputs(input.inputs);
  return {
    name,
    description,
    body: checkBody(input.body, checkedInputs.map((i) => i.key)),
    inputs: checkedInputs,
  };
}

/** Each field's first problem, so the editor can show it beside that field. */
export interface SkillDraftProblems {
  name?: string;
  description?: string;
  body?: string;
  /** Keyed by row index. */
  inputs: Record<number, string>;
}

function problem(check: () => unknown): string | undefined {
  try {
    check();
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : "invalid";
  }
}

/**
 * The same checks as `validateSkillDraft`, run per field instead of stopping at
 * the first — the API needs one message, a form needs to point at every field.
 */
export function skillDraftProblems(draft: SkillDraft): SkillDraftProblems {
  const seen = new Set<string>();
  const rows: Record<number, string> = {};
  draft.inputs.forEach((input, i) => {
    const why = problem(() => checkInput(input, i, seen));
    if (why) rows[i] = why;
  });
  return {
    name: problem(() => checkName(draft.name)),
    description: problem(() =>
      text(draft.description, "description", SKILL_LIMITS.description),
    ),
    body: problem(() => checkBody(draft.body, draft.inputs.map((i) => i.key.trim()))),
    inputs: rows,
  };
}

export function hasProblems(p: SkillDraftProblems): boolean {
  return Boolean(p.name || p.description || p.body || Object.keys(p.inputs).length);
}

/** What a name or key becomes as it is typed: the slug the validator accepts. */
export function toSkillName(raw: string): string {
  return raw.toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export function toInputKey(raw: string): string {
  return raw.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/** Inputs declared but never used in the body — legal, but worth a hint. */
export function unusedInputs(draft: Pick<SkillDraft, "body" | "inputs">): string[] {
  const used = new Set(placeholdersIn(draft.body));
  return draft.inputs.map((i) => i.key).filter((key) => !used.has(key));
}

/**
 * The values a run supplies, keyed by input. Unknown keys are dropped; a missing
 * required input throws, since the procedure would start from a blank.
 */
export function validateSkillValues(
  skill: Pick<SkillView, "inputs">,
  raw: unknown,
): Record<string, string> {
  const given = (raw ?? {}) as Record<string, unknown>;
  const values: Record<string, string> = {};
  for (const input of skill.inputs) {
    const value = typeof given[input.key] === "string" ? (given[input.key] as string).trim() : "";
    if (!value && input.required) throw new Error(`${input.label} is required`);
    if (value.length > SKILL_LIMITS.inputValue)
      throw new Error(`${input.label} must be at most ${SKILL_LIMITS.inputValue} characters`);
    if (value) values[input.key] = value;
  }
  return values;
}
