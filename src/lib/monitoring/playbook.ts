import type { AssessmentTarget, ObservationSource, WorkloadTechnology } from "./types";

/**
 * A PLAYBOOK is a method, not a question.
 *
 * The rubric (`monitoring_checks`) owns what is asked and what a finding IS; a
 * playbook owns how a senior engineer would go and measure it — where the data
 * lives for this technology, which counters and queries matter, and in what order
 * to look. Keeping the two apart is what lets us go deep without handing the model
 * authorship of identity: it can be told exactly how to investigate PostgreSQL
 * while still only ever answering the checks we declared.
 *
 * A consequence of that split, deliberate: a playbook must never say "report a
 * finding if X". That is a check's job, and a method that smuggles in verdicts
 * would drift the rubric invisibly.
 *
 * A playbook is NOT versioned. It is edited and saved, and what a given run was
 * actually told is recorded on the run itself (`monitoring_runs.prompts` and
 * `expected_observations`) — the verbatim text beats a number that only points at
 * text nobody kept.
 *
 * Why this text ships from Drill instead of living in a Holmes `customSkills`
 * skill: Holmes selects skills itself, from a name-and-description catalogue, via
 * the `fetch_skill` tool — there is no request field that can force one. For an
 * unattended assessment whose whole purpose is comparability, "the method may or
 * may not have been applied" is not an acceptable state, and cluster-side ConfigMap
 * text is something Drill can neither control nor prove was used. Moving to a skill
 * later is a token optimisation, and when we do it the run must record which skill
 * was fetched so a skipped fetch is visible rather than silent.
 */
export interface Playbook {
  technology: WorkloadTechnology;
  /** One paragraph of framing: what this technology dies of, in priority order. */
  framing: string;
  /**
   * Where this instance's data lives. `{{namespace}}` and `{{name}}` are
   * substituted per target.
   *
   * This is the half that playbooks are useless without: "query
   * pg_stat_statements" means nothing to an agent that does not know which of
   * several databases this StatefulSet is, or what the toolset is called. Guessing
   * costs tool calls, and an agent economising on tool calls is exactly the
   * behaviour we are trying to fix.
   */
  dataSources: string[];
  /** The ordered procedure. Each entry is one step, most-fatal-first. */
  method: string[];
  /** Facts the run must bring back, and the source each must come from. */
  observations: readonly ObservationSpec[];
}

/**
 * A playbook as the admin UI sees it, mirroring {@link CheckView}'s job for the
 * rubric: the live row is in the database, so the page receives it in a payload
 * instead of importing the code definition. Extends {@link Playbook} rather than
 * restating it, so the editor and the prompt can never disagree about the shape.
 */
export interface PlaybookView extends Playbook {
  /** The checks this method exists to answer — read-only context for the editor. */
  checkIds: string[];
  /**
   * How many readings each observation key already has. A key with readings is
   * locked: the editor will not let it be renamed, because the key IS the axis its
   * trend is plotted on. Counted per key rather than per playbook because two
   * engines that measure the same thing deliberately share a key, and then it is
   * the same trend axis in both methods.
   */
  readings: Record<string, number>;
  /** When it was last edited; null while it is still the shipped text. */
  editedAt: string | null;
}

/**
 * What a deep run was told to measure, per target. Snapshotted onto the run
 * (`monitoring_runs.expected_observations`) because the answer to "which readings
 * are missing" has to be graded against the method the run was actually given,
 * not against whatever the playbook says today.
 */
export interface ExpectedObservations {
  target: AssessmentTarget;
  technology: WorkloadTechnology;
  keys: string[];
}

/**
 * One required measurement. These are the depth-forcing device: a schema whose
 * fields cannot be filled from `kubectl get -o yaml` cannot be satisfied by reading
 * the manifest, and a key that comes back missing is a visible gap rather than
 * silence. The keys are also the trend axis, so they are permanent — rename one and
 * its history stops joining up, exactly like renaming a check.
 */
export interface ObservationSpec {
  /** Permanent dotted key, e.g. "wal.generation_bytes_per_day". */
  key: string;
  source: ObservationSource;
  /** "bytes", "seconds", "%", "" — display only. */
  unit: string;
  /** What to measure and how to get it. */
  how: string;
}

/** Substitute a target into a playbook's data-source lines. */
function renderDataSources(
  playbook: Playbook,
  target: AssessmentTarget,
): string[] {
  return playbook.dataSources.map((line) =>
    line
      .replaceAll("{{namespace}}", target.namespace)
      .replaceAll("{{name}}", target.name),
  );
}

/**
 * The playbook as prompt text for one target. Kept here rather than in `assess.ts`
 * so the whole rendered form of a method lives next to its definition — and so it
 * can be lifted verbatim into a Holmes skill file later without rewriting.
 */
export function renderPlaybook(
  playbook: Playbook,
  target: AssessmentTarget,
): string {
  const sources = renderDataSources(playbook, target)
    .map((line) => `- ${line}`)
    .join("\n");
  const steps = playbook.method
    .map((step, i) => `${i + 1}. ${step}`)
    .join("\n");
  const facts = playbook.observations
    .map((o) => `- ${o.key} [${o.source}${o.unit ? `, ${o.unit}` : ""}] — ${o.how}`)
    .join("\n");

  return `INVESTIGATION METHOD — ${playbook.technology}
${playbook.framing}

WHERE THE DATA IS
${sources}

HOW TO INVESTIGATE, in this order
${steps}

MEASUREMENTS TO RETURN in "observations" — one entry per key you could measure, tagged with the source you got it from. Omit a key you genuinely could not measure and say why in "sources_unavailable"; never invent or estimate a value.
${facts}`;
}
