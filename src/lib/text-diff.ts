/**
 * Line and word diffs of prose, for showing what an edit changed. Pure and
 * client-safe. Moved out of the playbook differ so skills compare text the same
 * way; the playbook-specific comparisons (measurements by key) stay there.
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
      /** Present only when the diff was asked for detail — see `diffLines`. */
      words?: WordSegment[];
    };

export interface LineDiff {
  ops: LineOp[];
  added: number;
  removed: number;
  changed: number;
}

export type RawOp = { kind: "same" | "removed" | "added"; a?: number; b?: number };

/**
 * Longest common subsequence, walked into a list of operations. Inputs here are small
 * (a playbook's 40 lines, a skill procedure's few hundred, a paragraph's words), so the
 * quadratic table is cheaper than being clever and is exact.
 */
export function lcsOps<T>(
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
export function similarity(a: string, b: string): number {
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
  /**
   * Whether to word-diff the lines that paired up. The LINE diff is cheap — a
   * handful of lines — but a word diff per changed line is not, and the counts in
   * the footer do not need it. Off while typing, on for the review panel.
   */
  options: { words?: boolean } = {},
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
        words: options.words ? diffWords(from, to) : undefined,
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
