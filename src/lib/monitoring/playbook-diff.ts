import type { ObservationSpec } from "./playbook";

/**
 * What changed between two texts of a method.
 *
 * Written rather than pulled from a dependency because the shapes being compared are
 * ours: a playbook is three ordered lists of prose plus a keyed table, and each wants
 * a different comparison. A generic text differ would flatten all four into lines and
 * lose the two things that actually matter — that a measurement is identified by its
 * KEY (so an edited `how` is a change, not a delete plus an add) and that a method
 * step is prose (so an edited step should read as one changed step with the words
 * marked, not as a removal followed by an unrelated addition).
 *
 * Everything here is pure and client-safe: the editor renders the unsaved form
 * state against the method as it is currently saved.
 */

export interface WordSegment {
  kind: "same" | "added" | "removed";
  text: string;
}

export type LineOp =
  | { kind: "same"; text: string; index: number }
  | { kind: "added"; text: string; index: number }
  | { kind: "removed"; text: string; index: number }
  | {
      kind: "changed";
      text: string;
      before: string;
      index: number;
      words: WordSegment[];
    };

export interface LineDiff {
  ops: LineOp[];
  added: number;
  removed: number;
  changed: number;
}

export interface ObservationChange {
  after: ObservationSpec;
  before: ObservationSpec;
  fields: ("source" | "unit" | "how")[];
}

export interface ObservationDiff {
  added: ObservationSpec[];
  removed: ObservationSpec[];
  changed: ObservationChange[];
  /** Keys present in both but at a different point in the order the prompt asks them. */
  moved: string[];
  unchanged: number;
}

export interface PlaybookDiff {
  /** Null when that section is untouched — the UI shows nothing rather than "0 changes". */
  framing: WordSegment[] | null;
  dataSources: LineDiff | null;
  method: LineDiff | null;
  observations: ObservationDiff | null;
  /** Section names in the words the UI already uses for them. */
  sections: string[];
  /** One line: "framing rewritten · 8 steps added, 3 changed · 21 measurements added". */
  headline: string;
}

/** The comparable half of a playbook — either side may be unsaved form state. */
export interface MethodText {
  framing: string;
  dataSources: readonly string[];
  method: readonly string[];
  observations: readonly ObservationSpec[];
}

type RawOp = { kind: "same" | "removed" | "added"; a?: number; b?: number };

/**
 * Longest common subsequence, walked into a list of operations. Inputs here are tiny
 * (at most 40 lines, or a few hundred words in one paragraph), so the quadratic table
 * is cheaper than being clever and is exact.
 */
function lcsOps<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): RawOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = same(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (same(a[i], b[j])) {
      ops.push({ kind: "same", a: i, b: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ kind: "removed", a: i });
      i++;
    } else {
      ops.push({ kind: "added", b: j });
      j++;
    }
  }
  while (i < n) ops.push({ kind: "removed", a: i++ });
  while (j < m) ops.push({ kind: "added", b: j++ });
  return ops;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

/** Word-level diff of two prose strings, with runs of one kind merged. */
export function diffWords(before: string, after: string): WordSegment[] {
  const a = words(before);
  const b = words(after);
  const segments: WordSegment[] = [];
  for (const op of lcsOps(a, b, (x, y) => x === y)) {
    const kind =
      op.kind === "same" ? "same" : op.kind === "added" ? "added" : "removed";
    const text = op.kind === "removed" ? a[op.a!] : b[op.b!];
    const last = segments[segments.length - 1];
    if (last && last.kind === kind) last.text += ` ${text}`;
    else segments.push({ kind, text });
  }
  return segments;
}

/** Token overlap, for deciding whether a removal and an addition are one edit. */
function similarity(a: string, b: string): number {
  const setA = new Set(words(a.toLowerCase()));
  const setB = new Set(words(b.toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  return shared / Math.max(setA.size, setB.size);
}

/**
 * Anything above this counts as "the same line, edited" rather than two unrelated
 * lines. Deliberately low: these are long prose steps, so a substantially rewritten
 * step still shares most of its vocabulary, and showing it as one changed step with
 * the words marked is far more readable than a removal next to an addition.
 */
const CHANGED_THRESHOLD = 0.35;

/**
 * Line diff over an ordered list of prose, pairing adjacent removals and additions
 * into single "changed" entries where they are recognisably the same line edited.
 */
export function diffLines(
  before: readonly string[],
  after: readonly string[],
): LineDiff {
  const raw = lcsOps(before, after, (x, y) => x === y);
  const ops: LineOp[] = [];

  let cursor = 0;
  while (cursor < raw.length) {
    const op = raw[cursor];
    if (op.kind === "same") {
      ops.push({ kind: "same", text: after[op.b!], index: op.b! });
      cursor++;
      continue;
    }
    // Collect this run of removals followed by additions and try to pair them up.
    const removed: number[] = [];
    const added: number[] = [];
    while (cursor < raw.length && raw[cursor].kind === "removed")
      removed.push(raw[cursor++].a!);
    while (cursor < raw.length && raw[cursor].kind === "added")
      added.push(raw[cursor++].b!);

    const pairs = Math.min(removed.length, added.length);
    let paired = 0;
    for (let k = 0; k < pairs; k++) {
      const from = before[removed[k]];
      const to = after[added[k]];
      if (similarity(from, to) < CHANGED_THRESHOLD) break;
      ops.push({
        kind: "changed",
        text: to,
        before: from,
        index: added[k],
        words: diffWords(from, to),
      });
      paired++;
    }
    for (let k = paired; k < removed.length; k++)
      ops.push({ kind: "removed", text: before[removed[k]], index: removed[k] });
    for (let k = paired; k < added.length; k++)
      ops.push({ kind: "added", text: after[added[k]], index: added[k] });
  }

  return {
    ops,
    added: ops.filter((o) => o.kind === "added").length,
    removed: ops.filter((o) => o.kind === "removed").length,
    changed: ops.filter((o) => o.kind === "changed").length,
  };
}

/**
 * Measurements diff by KEY, not by position. The key is the identity — it is the
 * trend axis — so an altered source or wording is a change to that measurement, and
 * only a key appearing or disappearing is an add or a delete.
 */
export function diffObservations(
  before: readonly ObservationSpec[],
  after: readonly ObservationSpec[],
): ObservationDiff {
  const byKeyBefore = new Map(before.map((spec) => [spec.key, spec]));
  const byKeyAfter = new Map(after.map((spec) => [spec.key, spec]));

  const added = after.filter((spec) => !byKeyBefore.has(spec.key));
  const removed = before.filter((spec) => !byKeyAfter.has(spec.key));
  const changed: ObservationChange[] = [];
  let unchanged = 0;

  for (const spec of after) {
    const previous = byKeyBefore.get(spec.key);
    if (!previous) continue;
    const fields = (["source", "unit", "how"] as const).filter(
      (field) => previous[field] !== spec[field],
    );
    if (fields.length > 0) changed.push({ after: spec, before: previous, fields });
    else unchanged++;
  }

  // Order matters: it is the order the prompt asks for the measurements in. A key
  // that survived but jumped position is neither added nor changed, so say so.
  const common = new Set([...byKeyBefore.keys()].filter((k) => byKeyAfter.has(k)));
  const seqBefore = before.map((s) => s.key).filter((k) => common.has(k));
  const seqAfter = after.map((s) => s.key).filter((k) => common.has(k));
  const kept = new Set(
    lcsOps(seqBefore, seqAfter, (x, y) => x === y)
      .filter((op) => op.kind === "same")
      .map((op) => seqAfter[op.b!]),
  );
  const moved = seqAfter.filter((key) => !kept.has(key));

  return { added, removed, changed, moved, unchanged };
}

function countPhrase(
  noun: string,
  plural: string,
  counts: { added: number; removed: number; changed: number },
): string | null {
  const parts = [
    counts.added > 0 ? `${counts.added} added` : null,
    counts.removed > 0 ? `${counts.removed} removed` : null,
    counts.changed > 0 ? `${counts.changed} changed` : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  const total = counts.added + counts.removed + counts.changed;
  return `${total === 1 ? noun : plural} ${parts.join(", ")}`;
}

/**
 * The whole comparison, or null when the two texts say the same thing.
 *
 * `before` is whatever is being compared against — the text this release ships when
 * the page renders drift, or the saved row when the editor previews an unsaved edit.
 */
/**
 * "rewritten" or merely "edited". A few swapped words and a wholesale replacement are
 * both textual changes but they are not the same news, and the summary line is often
 * the only thing anyone reads.
 */
function framingVerb(segments: WordSegment[]): string {
  const total = segments.reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  const touched = segments
    .filter((s) => s.kind !== "same")
    .reduce((n, s) => n + s.text.split(/\s+/).length, 0);
  return touched / Math.max(total, 1) > 0.25 ? "framing rewritten" : "framing edited";
}

export function diffMethod(
  before: MethodText,
  after: MethodText,
): PlaybookDiff | null {
  const framingChanged = before.framing !== after.framing;
  const dataSources = diffLines(before.dataSources, after.dataSources);
  const method = diffLines(before.method, after.method);
  const observations = diffObservations(before.observations, after.observations);

  const sourcesTouched =
    dataSources.added + dataSources.removed + dataSources.changed > 0;
  const methodTouched = method.added + method.removed + method.changed > 0;
  const observationsTouched =
    observations.added.length +
      observations.removed.length +
      observations.changed.length +
      observations.moved.length >
    0;

  if (
    !framingChanged &&
    !sourcesTouched &&
    !methodTouched &&
    !observationsTouched
  )
    return null;

  const sections = [
    framingChanged ? "framing" : null,
    sourcesTouched ? "data sources" : null,
    methodTouched ? "method" : null,
    observationsTouched ? "measurements" : null,
  ].filter(Boolean) as string[];

  const framing = framingChanged
    ? diffWords(before.framing, after.framing)
    : null;

  const headline = [
    framing ? framingVerb(framing) : null,
    sourcesTouched ? countPhrase("data source", "data sources", dataSources) : null,
    methodTouched ? countPhrase("step", "steps", method) : null,
    observationsTouched
      ? countPhrase("measurement", "measurements", {
          added: observations.added.length,
          removed: observations.removed.length,
          changed: observations.changed.length,
        }) ??
        `${observations.moved.length} measurement${observations.moved.length === 1 ? "" : "s"} reordered`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    framing,
    dataSources: sourcesTouched ? dataSources : null,
    method: methodTouched ? method : null,
    observations: observationsTouched ? observations : null,
    sections,
    headline,
  };
}
