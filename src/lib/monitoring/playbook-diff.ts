import type { ObservationSpec } from "./playbook";
import {
  diffLines,
  diffWords,
  lcsOps,
  similarity,
  type LineDiff,
  type WordSegment,
} from "@/lib/text-diff";

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
function framingVerb(before: string, after: string): string {
  // Token overlap rather than the fraction of words the word-diff touched. It is
  // the same judgement to within a rounding error, and it is O(n) — which is what
  // lets the footer stay honest on every keystroke without building a word matrix
  // over a few hundred words each time.
  return similarity(before, after) < 0.75
    ? "framing rewritten"
    : "framing edited";
}

export function diffMethod(
  before: MethodText,
  after: MethodText,
  /**
   * With `detail: false` the result carries the counts, the sections and the
   * headline but no word-level segments — everything the footer shows, and nothing
   * the review panel needs.
   *
   * The distinction is the difference between a responsive editor and a janky one.
   * The full diff builds a word-level LCS matrix over the framing paragraph (a few
   * hundred words, so on the order of a hundred thousand cells) plus another one
   * per changed line, and the form calls this on every keystroke to keep the save
   * button and the footer honest. That work is only ever LOOKED at behind the
   * "Review changes" toggle.
   */
  options: { detail?: boolean } = {},
): PlaybookDiff | null {
  const framingChanged = before.framing !== after.framing;
  const lineOptions = { words: options.detail === true };
  const dataSources = diffLines(before.dataSources, after.dataSources, lineOptions);
  const method = diffLines(before.method, after.method, lineOptions);
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

  const framing =
    framingChanged && options.detail
      ? diffWords(before.framing, after.framing)
      : null;

  const headline = [
    framingChanged ? framingVerb(before.framing, after.framing) : null,
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
