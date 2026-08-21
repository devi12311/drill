import type { ObservationSpec, Playbook } from "./playbook";
import { OBSERVATION_SOURCES, type ObservationSource } from "./types";

/**
 * Request-body parsing for an edited method, the counterpart to
 * `check-input.ts`. Throws with a user-facing message (the repo validates by
 * hand — there is no zod).
 *
 * Two rules here are not ordinary field validation, and both exist because this
 * text goes into a prompt and its keys are a permanent trend axis:
 *
 * 1. Placeholders are a closed set. `renderPlaybook` substitutes `{{namespace}}`
 *    and `{{name}}` and nothing else, so `{{workload}}` would not fail — it would
 *    ship to the model verbatim and quietly make the binding useless.
 * 2. Dropping an observation key that already has readings must be explicit.
 *    A rename and a delete-plus-add are indistinguishable in a payload, so the
 *    only enforceable invariant is that a key with history cannot leave silently:
 *    the caller has to name it in `dropKeys` and accept ending its series.
 */

/**
 * The editable half of a playbook — `technology` is immutable and never an input.
 * Spelled out rather than derived from {@link Playbook} because this is what gets
 * written: the arrays are mutable here, while the playbook the prompt reads keeps
 * them readonly.
 */
export interface PlaybookContent {
  framing: string;
  dataSources: string[];
  method: string[];
  observations: ObservationSpec[];
}

export interface PlaybookPatch extends PlaybookContent {
  /** Keys with readings that the caller has explicitly accepted losing. */
  dropKeys: string[];
}

/**
 * Exported so the EDITOR can enforce and count against exactly what the route
 * enforces. Every one of these used to surface only as a 400 with a message at the
 * foot of a scrolling dialog, after a round trip.
 */
export const PLAYBOOK_LIMITS = {
  framing: 4000,
  entry: 3000,
  entries: 40,
  how: 1000,
  unit: 24,
  observations: 150,
} as const;

const LIMITS = PLAYBOOK_LIMITS;

/** Lowercase dotted path, e.g. `wal.generation_bytes_per_day`. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/;

/** What `renderPlaybook` actually substitutes. Exported for the editor's hints. */
export const PLACEHOLDERS = ["namespace", "name"];
const PLACEHOLDER_PATTERN = /\{\{([^}]*)\}\}/g;

function assertPlaceholders(value: string, field: string) {
  for (const [, inner] of value.matchAll(PLACEHOLDER_PATTERN)) {
    if (!PLACEHOLDERS.includes(inner.trim()))
      throw new Error(
        `${field} uses an unknown placeholder {{${inner.trim()}}}. Only {{namespace}} and {{name}} are substituted — anything else reaches the model as literal text.`,
      );
  }
}

function text(raw: unknown, field: string, max: number, required = true) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value && required) throw new Error(`${field} is required`);
  if (value.length > max)
    throw new Error(`${field} must be at most ${max} characters`);
  assertPlaceholders(value, field);
  return value;
}

function lines(raw: unknown, fallback: readonly string[], field: string) {
  if (raw === undefined) return [...fallback];
  if (!Array.isArray(raw)) throw new Error(`${field} must be an array of lines`);
  // Blank entries are dropped rather than rejected: the editor adds an empty row
  // for typing into, and an abandoned one is not an error worth blocking a save.
  const values = raw
    .map((line, i) => text(line, `${field}[${i + 1}]`, LIMITS.entry, false))
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${field} needs at least one entry`);
  if (values.length > LIMITS.entries)
    throw new Error(`${field} cannot have more than ${LIMITS.entries} entries`);
  return values;
}

function observations(
  raw: unknown,
  fallback: readonly ObservationSpec[],
): ObservationSpec[] {
  if (raw === undefined) return [...fallback];
  if (!Array.isArray(raw))
    throw new Error("observations must be an array of measurements");

  const specs: ObservationSpec[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object")
      throw new Error(`observations[${i + 1}] must be an object`);
    const spec = entry as Record<string, unknown>;
    const label = `observations[${i + 1}]`;
    const key = typeof spec.key === "string" ? spec.key.trim() : "";
    const how = typeof spec.how === "string" ? spec.how.trim() : "";
    // An entirely blank row is the editor's "new measurement" placeholder.
    if (!key && !how) continue;

    if (!KEY_PATTERN.test(key))
      throw new Error(
        `${label}: "${key}" is not a valid key. Use lowercase dotted words, e.g. wal.generation_bytes_per_day.`,
      );
    if (seen.has(key))
      throw new Error(`${label}: the key "${key}" appears twice`);
    seen.add(key);

    if (
      typeof spec.source !== "string" ||
      !(OBSERVATION_SOURCES as readonly string[]).includes(spec.source)
    )
      throw new Error(
        `${label}: source must be one of: ${OBSERVATION_SOURCES.join(", ")}`,
      );

    specs.push({
      key,
      source: spec.source as ObservationSource,
      unit: text(spec.unit ?? "", `${label}.unit`, LIMITS.unit, false),
      how: text(how, `${label}.how`, LIMITS.how),
    });
  }

  if (specs.length === 0)
    throw new Error(
      "A playbook needs at least one measurement — the observation keys are what force a real investigation rather than a manifest read.",
    );
  if (specs.length > LIMITS.observations)
    throw new Error(
      `A playbook cannot ask for more than ${LIMITS.observations} measurements`,
    );
  return specs;
}

/** Field-by-field, falling back to the live row so a PATCH can be partial. */
export function parsePlaybookPatch(
  body: Record<string, unknown>,
  existing: Playbook,
): PlaybookPatch {
  const dropKeysRaw = body.dropKeys;
  if (dropKeysRaw !== undefined && !Array.isArray(dropKeysRaw))
    throw new Error("dropKeys must be an array of observation keys");

  return {
    framing: text(
      body.framing ?? existing.framing,
      "framing",
      LIMITS.framing,
    ),
    dataSources: lines(body.dataSources, existing.dataSources, "dataSources"),
    method: lines(body.method, existing.method, "method"),
    observations: observations(body.observations, existing.observations),
    dropKeys: (dropKeysRaw ?? []).filter(
      (key: unknown): key is string => typeof key === "string",
    ),
  };
}

/**
 * Keys that would lose their history without the caller saying so. Returns the
 * offending keys with their reading counts, for a 409 the UI can act on.
 */
export function unacknowledgedKeyLosses(
  before: readonly ObservationSpec[],
  after: readonly ObservationSpec[],
  readings: Record<string, number>,
  dropKeys: readonly string[],
): { key: string; readings: number }[] {
  const kept = new Set(after.map((spec) => spec.key));
  const accepted = new Set(dropKeys);
  return before
    .filter(
      (spec) =>
        !kept.has(spec.key) &&
        !accepted.has(spec.key) &&
        (readings[spec.key] ?? 0) > 0,
    )
    .map((spec) => ({ key: spec.key, readings: readings[spec.key] ?? 0 }));
}
