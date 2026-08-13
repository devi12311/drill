import {
  REQUIREMENT_LABEL,
  validateCheckId,
  type CheckRequirement,
} from "./catalogue";
import {
  MONITOR_CATEGORIES,
  SEVERITIES,
  WORKLOAD_KINDS,
  type MonitorCategory,
  type Severity,
  type WorkloadKind,
} from "./types";

/**
 * Request-body parsing for admin-authored checks, shared by the create and
 * update routes so the two cannot drift. Throws with a user-facing message
 * (the repo validates by hand — there is no zod).
 */

export interface CheckInput {
  category: MonitorCategory;
  title: string;
  question: string;
  evidence: string;
  reference: string;
  baseSeverity: Severity;
  appliesTo: WorkloadKind[];
  requires: CheckRequirement | null;
  resolveAfterAbsentRuns: number;
  enabled: boolean;
}

const REQUIREMENTS = Object.keys(REQUIREMENT_LABEL) as CheckRequirement[];

function text(raw: unknown, field: string, max: number, required = true) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value && required) throw new Error(`${field} is required`);
  if (value.length > max)
    throw new Error(`${field} must be at most ${max} characters`);
  return value;
}

/** Field-by-field, falling back to `existing` so PATCH can be partial. */
export function parseCheckInput(
  body: Record<string, unknown>,
  existing?: CheckInput,
): CheckInput {
  const category =
    body.category === undefined
      ? existing?.category
      : typeof body.category === "string" &&
          (MONITOR_CATEGORIES as readonly string[]).includes(body.category)
        ? (body.category as MonitorCategory)
        : undefined;
  if (!category)
    throw new Error(`category must be one of: ${MONITOR_CATEGORIES.join(", ")}`);

  const severityRaw =
    body.baseSeverity === undefined
      ? existing?.baseSeverity
      : typeof body.baseSeverity === "string"
        ? body.baseSeverity
        : "";
  if (
    !severityRaw ||
    !(SEVERITIES as readonly string[]).includes(severityRaw as string)
  )
    throw new Error(`baseSeverity must be one of: ${SEVERITIES.join(", ")}`);

  let appliesTo: WorkloadKind[];
  if (body.appliesTo === undefined) {
    appliesTo = existing?.appliesTo ?? [];
  } else if (Array.isArray(body.appliesTo)) {
    appliesTo = body.appliesTo
      .map((k) => (typeof k === "string" ? k.toLowerCase() : ""))
      .filter((k): k is WorkloadKind =>
        (WORKLOAD_KINDS as readonly string[]).includes(k),
      );
  } else {
    throw new Error("appliesTo must be an array of workload kinds");
  }
  // Both kinds selected means "no restriction" — store it as such so the
  // catalogue has one representation of "applies to everything".
  if (appliesTo.length === WORKLOAD_KINDS.length) appliesTo = [];

  let requires: CheckRequirement | null;
  if (body.requires === undefined) {
    requires = existing?.requires ?? null;
  } else if (body.requires === null || body.requires === "") {
    requires = null;
  } else if (
    typeof body.requires === "string" &&
    REQUIREMENTS.includes(body.requires as CheckRequirement)
  ) {
    requires = body.requires as CheckRequirement;
  } else {
    throw new Error(`requires must be null or one of: ${REQUIREMENTS.join(", ")}`);
  }

  const absentRaw =
    body.resolveAfterAbsentRuns === undefined
      ? (existing?.resolveAfterAbsentRuns ?? 1)
      : Number(body.resolveAfterAbsentRuns);
  if (!Number.isInteger(absentRaw) || absentRaw < 1 || absentRaw > 10)
    throw new Error("resolveAfterAbsentRuns must be a whole number from 1 to 10");

  return {
    category,
    title: text(body.title ?? existing?.title, "title", 120),
    question: text(body.question ?? existing?.question, "question", 2000),
    evidence: text(body.evidence ?? existing?.evidence, "evidence", 2000),
    reference: text(
      body.reference ?? existing?.reference ?? "",
      "reference",
      300,
      false,
    ),
    baseSeverity: severityRaw as Severity,
    appliesTo,
    requires,
    resolveAfterAbsentRuns: absentRaw,
    enabled:
      body.enabled === undefined
        ? (existing?.enabled ?? true)
        : body.enabled !== false,
  };
}

/**
 * Fields whose change alters what the check MEANS, and so must bump its
 * version — a concern raised under the old wording should stay distinguishable
 * from one raised under the new. Cosmetic edits (reference, enabled) do not.
 */
const SEMANTIC_FIELDS: (keyof CheckInput)[] = [
  "question",
  "evidence",
  "baseSeverity",
  "category",
  "appliesTo",
  "requires",
  "resolveAfterAbsentRuns",
];

export function isSemanticChange(before: CheckInput, after: CheckInput) {
  return SEMANTIC_FIELDS.some(
    (field) =>
      JSON.stringify(before[field] ?? null) !==
      JSON.stringify(after[field] ?? null),
  );
}

export { validateCheckId };
