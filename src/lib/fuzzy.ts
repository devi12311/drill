/**
 * IDE-style fuzzy matching ("cointpro" → cost-integration-problems): the query's
 * characters must appear in order, and the best-scoring alignment wins — one
 * that lands on word starts and keeps runs contiguous beats one that scatters.
 */

export interface FuzzyMatch {
  score: number;
  /** Indices in the target that the query matched, ascending — for highlighting. */
  positions: number[];
}

const WORD_START = 8;
const TARGET_START = 4; // on top of WORD_START
const CONSECUTIVE = 6;
const GAP = 1; // per skipped character between two matches

function isWordStart(target: string, i: number): boolean {
  return i === 0 || /[-_.\s/]/.test(target[i - 1]);
}

/** Null when the query is not a subsequence of the target. Case-insensitive. */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return { score: 0, positions: [] };

  // best[i][j]: top score aligning q[0..i] with q[i] placed at t[j]; from[i][j]
  // is where q[i-1] sat on that path. Targets are short names, so the
  // O(|q|·|t|²) table costs nothing and, unlike a greedy scan, finds the
  // word-start alignment even when an earlier stray letter matches first.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < q.length; i++) {
    best.push(new Array(t.length).fill(-Infinity));
    from.push(new Array(t.length).fill(-1));
    for (let j = i; j < t.length; j++) {
      if (t[j] !== q[i]) continue;
      const bonus =
        1 + (isWordStart(t, j) ? WORD_START : 0) + (j === 0 ? TARGET_START : 0);
      if (i === 0) {
        best[i][j] = bonus;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const prev = best[i - 1][k];
        if (prev === -Infinity) continue;
        const link = k === j - 1 ? CONSECUTIVE : -GAP * (j - k - 1);
        if (prev + bonus + link > best[i][j]) {
          best[i][j] = prev + bonus + link;
          from[i][j] = k;
        }
      }
    }
  }

  const last = best[q.length - 1];
  let end = -1;
  for (let j = 0; j < t.length; j++) {
    if (last[j] !== -Infinity && (end < 0 || last[j] > last[end])) end = j;
  }
  if (end < 0) return null;

  const positions: number[] = [];
  for (let i = q.length - 1, j = end; i >= 0; j = from[i][j], i--) positions.unshift(j);
  return { score: last[end], positions };
}

/** Items whose key fuzzy-matches the query, best first (shorter key breaks ties). */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): { item: T; positions: number[] }[] {
  // Nothing typed yet: keep the caller's order rather than ranking by length.
  if (!query) return items.map((item) => ({ item, positions: [] }));
  return items
    .map((item) => ({ item, key: key(item), match: fuzzyMatch(query, key(item)) }))
    .filter((r) => r.match !== null)
    .sort((a, b) => b.match!.score - a.match!.score || a.key.length - b.key.length)
    .map((r) => ({ item: r.item, positions: r.match!.positions }));
}
