import { SEARCH_TOOL_NAME } from "@/lib/artifacts/types";
import { parseDecisions } from "@/lib/chat/describe";
import {
  awaitsApproval,
  isDrillTool,
  type PendingToolApproval,
  type ToolCall,
} from "@/lib/holmes/types";
import { FETCH_SKILL_TOOL_NAME } from "./prompt";
import { SKILL_LIMITS, checkInput, toInputKey } from "./types";

/**
 * Building a skill from a conversation's tool calls (docs/DECISIONS.md — "Skills
 * from conversations"). Client-safe: the builder rail and the draft route resolve
 * steps, detect inputs and check for leaked values with the same code.
 */

export const MAX_SKILL_STEPS = 25;
export const PURPOSE_LIMIT = 4000;
/** sessionStorage key the rail hands the generated draft to the editor under. */
export const SKILL_SEED_KEY = "drill:skill-seed";

/**
 * A call's identity across the conversation. The index, not `tool_call_id`: a
 * stored message never changes, and a resumed attempt can repeat an id.
 */
export function stepKey(messageId: string, index: number): string {
  return `${messageId}:${index}`;
}

/**
 * Drill's own tools by name: besides Drill's record of a call (toolset "drill-…"),
 * Holmes stores its own — "Frontend tool: …", with no toolset at all.
 */
const DRILL_TOOL_NAMES = new Set([SEARCH_TOOL_NAME, FETCH_SKILL_TOOL_NAME]);

/** A call someone may make a step of. TodoWrite is the plan widget, never a row. */
export function isAddableStep(call: ToolCall): boolean {
  return (
    call.tool_name !== "TodoWrite" && !isDrillTool(call) && !DRILL_TOOL_NAMES.has(call.tool_name)
  );
}

export interface ConversationStep {
  key: string;
  /** The stored message the call belongs to. */
  messageId: string;
  call: ToolCall;
  /** Position in the conversation — what step numbers follow. */
  order: number;
}

/**
 * Every call of the conversation's assistant messages, keyed, in conversation
 * order. A call paused for approval appears once: its later result replaces the
 * paused record (which keeps no output of its own).
 */
export function conversationCalls(
  messages: readonly { id: string; toolCalls: readonly ToolCall[] }[],
): ConversationStep[] {
  const answered = new Set<string>();
  const out: ConversationStep[] = [];
  // Walked newest first: a paused record is superseded by a result after it.
  for (const message of [...messages].reverse())
    for (let i = message.toolCalls.length - 1; i >= 0; i--) {
      const call = message.toolCalls[i];
      if (awaitsApproval(call) && answered.has(call.tool_call_id)) continue;
      if (!awaitsApproval(call)) answered.add(call.tool_call_id);
      out.push({ key: stepKey(message.id, i), messageId: message.id, call, order: 0 });
    }
  return out.reverse().map((step, order) => ({ ...step, order }));
}

export interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
  /** Assistant: the calls the answer stopped on, waiting for approval. */
  pendingApprovals?: readonly PendingToolApproval[] | null;
  /** User: the line ran a skill explicitly ("/name key=value"). */
  skillRun?: boolean;
}

/**
 * What the person asked, in order. A line answering a paused answer is their
 * approval decision ("Approved bash"), stored as a user message but not a question.
 */
export function askedQuestions(lines: readonly TranscriptLine[]): { text: string; skillRun: boolean }[] {
  return lines.flatMap((line, i) =>
    line.role === "user" &&
    line.text &&
    !parseDecisions(line.text, lines[i - 1]?.pendingApprovals ?? [])
      ? [{ text: line.text, skillRun: !!line.skillRun }]
      : [],
  );
}

/** `{a: 1, q: "SELECT …"}` → `a=1, q=SELECT …` on one line, for a card or a prompt. */
export function paramPreview(call: ToolCall): string {
  const params = call.result.params ?? {};
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(", ")
    .replace(/\s+/g, " ");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `value` as a whole token: `12` is not found inside `1234` or `id12`. */
function tokenPattern(value: string, flags = ""): RegExp {
  return new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(value)}(?![A-Za-z0-9_])`, flags);
}

export function containsValue(text: string, value: string): boolean {
  return value !== "" && tokenPattern(value).test(text);
}

/** Every whole-token occurrence of each value becomes its `{{key}}`. */
export function templateValues(
  text: string,
  inputs: readonly { key: string; value?: string }[],
): string {
  // Longest first, so `4821` inside a longer value is not replaced half-way.
  const withValues = inputs
    .filter((i): i is { key: string; value: string } => !!i.value)
    .sort((a, b) => b.value.length - a.value.length);
  return withValues.reduce(
    (out, { key, value }) => out.replace(tokenPattern(value, "g"), `{{${key}}}`),
    text,
  );
}

// ---- Detected inputs -------------------------------------------------------

/** Identifier shapes — also what the share scanner flags as one org's specifics. */
export const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Long hex: Mongo ObjectIds, trace and span ids. */
export const LONG_HEX_PATTERN = /\b[0-9a-f]{16,}\b/gi;

/** Value shapes worth offering as an input, most specific first. */
const CANDIDATES: { pattern: RegExp; kind: "quoted" | "id" | "date" | "token" }[] = [
  { pattern: /(["'`])([^"'`\n]{2,80})\1/g, kind: "quoted" },
  { pattern: UUID_PATTERN, kind: "id" },
  { pattern: LONG_HEX_PATTERN, kind: "id" },
  {
    pattern: /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,
    kind: "date",
  },
  // Letters and digits mixed, 4+ chars: int-4821, abc123def, a trace id.
  {
    pattern: /\b(?=[\w.-]*\d)(?=[\w.-]*[A-Za-z])[A-Za-z0-9][\w.-]{2,}[A-Za-z0-9]\b/g,
    kind: "token",
  },
  { pattern: /\b\d{3,}\b/g, kind: "id" },
];

/** Words that sit between a noun and its value: "the user with id 4821". */
const FILLER = new Set([
  "a", "an", "the", "for", "with", "of", "in", "on", "at", "is", "to", "from", "and",
  "or", "by", "as", "like", "this", "that", "number", "no", "named", "called", "id", "ids",
  "since", "after", "before", "until", "between",
]);

/**
 * The noun a value belongs to, from the few words just before it. A nearby "id"
 * wins: in "integration id cost 63ef…" the value is the integration's id.
 */
function nounBefore(text: string): { noun: string | null; saidId: boolean } {
  const words = text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [];
  const recent = words.slice(-3).reverse();
  const idAt = recent.findIndex((w) => /^ids?$/i.test(w));
  const owner = idAt >= 0 ? recent[idAt + 1] : undefined;
  if (owner && !FILLER.has(owner.toLowerCase())) return { noun: owner, saidId: true };
  return { noun: recent.find((w) => !FILLER.has(w.toLowerCase())) ?? null, saidId: false };
}

function suggestKey(kind: string, before: string): string | null {
  // A date's noun is rarely in front of it ("since 2026-10-01"): call it a date.
  if (kind === "date") return "date";
  const { noun, saidId } = nounBefore(before);
  if (!noun) return null;
  const key = toInputKey(noun);
  const wantsId = (kind === "id" || saidId) && !/id$/.test(key);
  return wantsId ? `${key}_id` : key;
}

export interface DetectedValue {
  value: string;
  key: string;
  /** 1-based numbers of the picked steps whose call uses the value. */
  steps: number[];
}

/**
 * Values from the user's questions that the picked steps reuse — the incident's
 * specifics (a user id, an integration name) that a reusable skill must take as
 * inputs. A value only in the question, or only in a call, is not offered: the
 * overlap is the signal.
 */
export function detectInputValues(
  questions: readonly string[],
  picked: readonly { number: number; call: ToolCall }[],
): DetectedValue[] {
  const haystacks = picked.map(({ number, call }) => ({
    number,
    text: `${call.description}\n${JSON.stringify(call.result.params ?? {})}`,
  }));
  const found = new Map<string, DetectedValue>();
  const taken = new Set<string>();

  for (const question of questions) {
    const spans: [number, number][] = [];
    for (const { pattern, kind } of CANDIDATES) {
      for (const m of question.matchAll(pattern)) {
        const value = kind === "quoted" ? m[2] : m[0];
        const start = m.index;
        const end = start + m[0].length;
        if (spans.some(([s, e]) => start < e && end > s)) continue;
        spans.push([start, end]);
        if (found.has(value)) continue;
        const steps = haystacks
          .filter((h) => containsValue(h.text, value))
          .map((h) => h.number);
        if (steps.length === 0) continue;
        let key = suggestKey(kind, question.slice(0, start));
        if (!key || !isValidKey(key)) key = `value_${found.size + 1}`;
        let unique = key;
        for (let n = 2; taken.has(unique); n++) unique = `${key}_${n}`.slice(0, 32);
        taken.add(unique);
        found.set(value, { value, key: unique, steps });
      }
    }
  }
  return [...found.values()];
}

function isValidKey(key: string): boolean {
  try {
    checkInput({ key, label: key }, 0, new Set());
    return true;
  } catch {
    return false;
  }
}

/** `user_id` → "User id". */
export function inputLabel(key: string): string {
  const words = key.replace(/_/g, " ").trim();
  return (words.charAt(0).toUpperCase() + words.slice(1)).slice(0, SKILL_LIMITS.label);
}
