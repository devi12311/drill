"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogBody } from "@/components/ui/dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Disclosure,
  ModalFooter,
} from "@/components/monitoring/definition-modal";

import {
  CATEGORY_LABEL,
  REQUIREMENT_LABEL,
  SELECT_CLASS,
  SEVERITY_LABEL,
  TARGET_KIND_LABEL,
  TECHNOLOGY_LABEL,
  describeScope,
  requirementLabel,
} from "@/lib/monitoring/ui";
import { CHECK_LIMITS } from "@/lib/monitoring/check-input";
import {
  CHECK_ID_PATTERN,
  CHECK_REQUIREMENTS,
  MONITOR_CATEGORIES,
  SEVERITIES,
  TARGET_KINDS,
  WORKLOAD_KINDS,
  WORKLOAD_TECHNOLOGIES,
  type MonitorCategory,
  type Severity,
  type TargetKind,
  type CheckRequirement,
  type CheckView,
  type WorkloadTechnology,
} from "@/lib/monitoring/types";

/**
 * Author or retune a check. Editing an existing one cannot change its ID —
 * concerns reference it by value, so a rename would orphan their history; the
 * form says so rather than silently disabling the field.
 *
 * Altitude is the organising idea. What a check IS — its question, the evidence
 * it must cite, how bad it is — stays visible; where it applies and how it is
 * tuned fold into one line each. That is not tidiness: the scope fieldsets are
 * some forty checkboxes whose answer is almost always "leave it", and given the
 * same altitude as the question they were most of the form's height.
 */

/** Everything the API accepts, and therefore everything "changed" can mean. */
interface CheckDraft {
  category: MonitorCategory;
  title: string;
  question: string;
  evidence: string;
  reference: string;
  baseSeverity: Severity;
  appliesTo: TargetKind[];
  appliesToTechnologies: WorkloadTechnology[];
  excludesTechnologies: WorkloadTechnology[];
  requires: string | null;
  resolveAfterAbsentRuns: number;
}

/** Order-insensitive, so re-ticking a box in a different order is not an edit. */
function sameDraft(a: CheckDraft, b: CheckDraft) {
  const key = (draft: CheckDraft) =>
    JSON.stringify({
      ...draft,
      appliesTo: [...draft.appliesTo].sort(),
      appliesToTechnologies: [...draft.appliesToTechnologies].sort(),
      excludesTechnologies: [...draft.excludesTechnologies].sort(),
    });
  return key(a) === key(b);
}

export function CheckForm({
  check,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  check?: CheckView;
  /** Receives the saved check's ID — a new one becomes the open panel. */
  onSaved: (saved: { id: string }) => void;
  onCancel: () => void;
  /** Lifted so the panel's Escape/overlay close can guard unsaved work. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const editing = Boolean(check);
  const [id, setId] = useState(check?.id ?? "");
  const [category, setCategory] = useState<MonitorCategory>(
    check?.category ?? "security",
  );
  const [title, setTitle] = useState(check?.title ?? "");
  const [question, setQuestion] = useState(check?.question ?? "");
  const [evidence, setEvidence] = useState(check?.evidence ?? "");
  const [reference, setReference] = useState(check?.reference ?? "");
  const [baseSeverity, setBaseSeverity] = useState<Severity>(
    check?.baseSeverity ?? "medium",
  );
  const [appliesTo, setAppliesTo] = useState<TargetKind[]>(
    (check?.appliesTo as TargetKind[]) ?? [],
  );
  /**
   * `appliesTo` is empty for "every workload kind", which is not a state a grid
   * of checkboxes can show — the old form ticked both boxes to represent it and
   * then had to explain, twice, that ticking them is the same as ticking
   * neither. Making the choice explicit says it once, in the widget.
   *
   * The MODE is its own state rather than derived from the list, because deriving
   * it made the control contradict itself: choose "only these", untick everything,
   * and `appliesTo.length === 0` flipped the radio silently back to "every kind".
   * Held separately, an empty selection stays an empty selection and gets told it
   * is incomplete.
   */
  const [everyKind, setEveryKind] = useState(
    ((check?.appliesTo as TargetKind[]) ?? []).length === 0,
  );

  const [appliesToTechnologies, setAppliesToTechnologies] = useState<
    WorkloadTechnology[]
  >((check?.appliesToTechnologies as WorkloadTechnology[]) ?? []);
  const [excludesTechnologies, setExcludesTechnologies] = useState<
    WorkloadTechnology[]
  >((check?.excludesTechnologies as WorkloadTechnology[]) ?? []);
  const [requires, setRequires] = useState(check?.requires ?? "");
  const [absentRuns, setAbsentRuns] = useState(
    String(check?.resolveAfterAbsentRuns ?? 1),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const draft: CheckDraft = useMemo(
    () => ({
      category,
      title,
      question,
      evidence,
      reference,
      baseSeverity,
      // "Every workload kind" IS the empty list, which is what the mode encodes.
      appliesTo: everyKind ? [] : appliesTo,
      appliesToTechnologies,
      excludesTechnologies,
      requires: requires || null,
      resolveAfterAbsentRuns: Number(absentRuns),
    }),
    [
      everyKind,
      category,
      title,
      question,
      evidence,
      reference,
      baseSeverity,
      appliesTo,
      appliesToTechnologies,
      excludesTechnologies,
      requires,
      absentRuns,
    ],
  );

  const saved: CheckDraft | null = useMemo(
    () =>
      check
        ? {
            category: check.category,
            title: check.title,
            question: check.question,
            evidence: check.evidence,
            reference: check.reference,
            baseSeverity: check.baseSeverity,
            appliesTo: check.appliesTo as TargetKind[],
            appliesToTechnologies:
              check.appliesToTechnologies as WorkloadTechnology[],
            excludesTechnologies:
              check.excludesTechnologies as WorkloadTechnology[],
            requires: check.requires,
            resolveAfterAbsentRuns: check.resolveAfterAbsentRuns,
          }
        : null,
    [check],
  );

  // Authoring counts as dirty from the first character typed; retuning only
  // once the draft actually differs from what is stored. Memoised: `sameDraft`
  // does two `JSON.stringify`s plus two sorts, and this is read on every render —
  // i.e. on every keystroke in any field.
  const dirty = useMemo(
    () =>
      saved
        ? !sameDraft(draft, saved)
        : Boolean(id || title || question || evidence),
    [saved, draft, id, title, question, evidence],
  );

  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  function toggleKind(kind: TargetKind) {
    setAppliesTo((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  }

  /**
   * Validated here, against the same constants the route validates against
   * (`CHECK_LIMITS`, `CHECK_ID_PATTERN` — both exported for exactly this) so the
   * two cannot drift. Every one of these used to be discoverable only by saving
   * and reading a single line of red text at the foot of a scrolling dialog.
   */
  const problems = useMemo(() => {
    const found: Record<string, string> = {};
    if (!editing && !CHECK_ID_PATTERN.test(id.trim()))
      found.id =
        "PREFIX.NAME — uppercase letters, digits and underscores, with a dot between, e.g. CUSTOM.INGRESS_TLS.";
    if (!title.trim()) found.title = "A title is required.";
    else if (title.length > CHECK_LIMITS.title)
      found.title = `${title.length} characters; the limit is ${CHECK_LIMITS.title}.`;
    if (!question.trim()) found.question = "The question is required.";
    else if (question.length > CHECK_LIMITS.question)
      found.question = `${question.length} characters; the limit is ${CHECK_LIMITS.question}.`;
    if (!evidence.trim()) found.evidence = "The evidence to cite is required.";
    else if (evidence.length > CHECK_LIMITS.evidence)
      found.evidence = `${evidence.length} characters; the limit is ${CHECK_LIMITS.evidence}.`;
    if (reference.length > CHECK_LIMITS.reference)
      found.reference = `${reference.length} characters; the limit is ${CHECK_LIMITS.reference}.`;
    if (!everyKind && appliesTo.length === 0)
      found.appliesTo = "Pick at least one kind, or choose every workload kind.";
    const runs = Number(absentRuns);
    if (
      !Number.isInteger(runs) ||
      runs < CHECK_LIMITS.absentRuns.min ||
      runs > CHECK_LIMITS.absentRuns.max
    )
      found.absentRuns = `A whole number from ${CHECK_LIMITS.absentRuns.min} to ${CHECK_LIMITS.absentRuns.max}.`;
    // Both lists are stored verbatim, so an engine in both is a check that can
    // never fire — worth saying before it is saved rather than never.
    const contradictory = appliesToTechnologies.filter((t) =>
      excludesTechnologies.includes(t),
    );
    if (contradictory.length > 0)
      found.technologies = `${contradictory.map((t) => TECHNOLOGY_LABEL[t]).join(", ")} ${contradictory.length === 1 ? "is" : "are"} in both lists, so this check would never run there.`;
    return found;
  }, [
    editing,
    id,
    title,
    question,
    evidence,
    reference,
    everyKind,
    appliesTo,
    absentRuns,
    appliesToTechnologies,
    excludesTechnologies,
  ]);
  const invalid = Object.keys(problems).length > 0;

  function toggleTechnology(
    technology: WorkloadTechnology,
    setter: typeof setAppliesToTechnologies,
  ) {
    setter((prev) =>
      prev.includes(technology)
        ? prev.filter((t) => t !== technology)
        : [...prev, technology],
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        editing
          ? `/api/admin/monitoring/checks/${check!.id}`
          : "/api/admin/monitoring/checks",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editing ? draft : { id, ...draft }),
        },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      // POST answers with the row; PATCH wraps it alongside its concern count.
      onSaved({ id: body.check?.id ?? body.id ?? id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the check");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
      <DialogBody className="space-y-6">
        {/* At the TOP of the body. The server's message used to be the last
            element of a scrolling form, i.e. off-screen exactly when the form was
            long enough to get wrong. */}
        {error && (
          <p role="alert" className="text-body-sm text-traffic-red">
            {error}
          </p>
        )}

        <FieldGroup
          title="Identity"
          purpose="How this check is referred to, for the rest of its life."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="check-id"
              label="Check ID"
              error={problems.id}
              description={
                editing
                  ? "Permanent — concerns reference it by value, so it can never be renamed."
                  : "PREFIX.NAME, uppercase. Chosen once and permanent, because concerns reference it by value."
              }
            >
              {(props) => (
                <Input
                  {...props}
                  value={id}
                  onChange={(e) => setId(e.target.value.toUpperCase())}
                  placeholder="CUSTOM.INGRESS_TLS"
                  className="font-mono text-[12px]"
                  autoComplete="off"
                  disabled={editing}
                />
              )}
            </Field>

            <Field
              id="check-title"
              label="Title"
              error={problems.title}
              value={title}
              limit={CHECK_LIMITS.title}
              description="The line that names the problem on a concern card. State the fault, not the test."
            >
              {(props) => (
                <Input
                  {...props}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ingress does not enforce TLS"
                  autoComplete="off"
                />
              )}
            </Field>
          </div>
        </FieldGroup>

        <FieldGroup
          title="What Holmes must answer"
          purpose="These two fields ARE the check. Both are copied into the prompt verbatim, once per workload."
        >
          <Field
            id="check-question"
            label="What must Holmes determine?"
            error={problems.question}
            value={question}
            limit={CHECK_LIMITS.question}
            description="Phrase it so a failure is unambiguous — a question that can be answered &ldquo;probably&rdquo; produces findings that cannot be compared between runs."
          >
            {(props) => (
              <Textarea
                {...props}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Does any Ingress routing to this workload lack a tls block, serving plaintext to clients?"
                className="h-20"
              />
            )}
          </Field>

          <Field
            id="check-evidence"
            label="Evidence it must cite"
            error={problems.evidence}
            value={evidence}
            limit={CHECK_LIMITS.evidence}
            description="The observed values a finding has to quote. Without this the model restates the question back as its own finding."
          >
            {(props) => (
              <Textarea
                {...props}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="The Ingress name, its host rules, and the tls block as configured."
                className="h-20"
              />
            )}
          </Field>
        </FieldGroup>

        <FieldGroup
          title="How it is rated"
          purpose="Which jobs ask this check, and how bad a failure is before Holmes has seen the cluster."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="check-category"
              label="Category"
              description="Decides which job type ever asks this check: a security job asks only security checks. It cannot be changed on a job, so it is worth getting right here."
            >
              {(props) => (
                <select
                  {...props}
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as MonitorCategory)
                  }
                  className={SELECT_CLASS}
                >
                  {MONITOR_CATEGORIES.map((option) => (
                    <option key={option} value={option} className="bg-popover">
                      {CATEGORY_LABEL[option]}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              id="check-severity"
              label="Base severity"
              description="Where a failure starts. Holmes may adjust it for the cluster it is looking at, but the deviation is recorded next to this rather than replacing it."
            >
              {(props) => (
                <select
                  {...props}
                  value={baseSeverity}
                  onChange={(e) => setBaseSeverity(e.target.value as Severity)}
                  className={SELECT_CLASS}
                >
                  {SEVERITIES.map((option) => (
                    <option key={option} value={option} className="bg-popover">
                      {SEVERITY_LABEL[option]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </FieldGroup>

        {/* Folded away, because the answer is almost always "leave it" — but the
            summary line says what the current answer is, so nobody has to open it
            to find out. */}
        <Disclosure label="Where it applies" summary={describeScope(draft)}>
          <fieldset className="space-y-1.5">
            <legend className="text-body-sm font-medium text-warm-off-white">
              Applies to
            </legend>
            <div className="flex flex-wrap gap-4">
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone">
                <input
                  type="radio"
                  name="check-applies-mode"
                  checked={everyKind}
                  onChange={() => setEveryKind(true)}
                  className="accent-warm-off-white"
                />
                Every workload kind
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone">
                <input
                  type="radio"
                  name="check-applies-mode"
                  checked={!everyKind}
                  onChange={() => {
                    setEveryKind(false);
                    if (appliesTo.length === 0) setAppliesTo([...WORKLOAD_KINDS]);
                  }}
                  className="accent-warm-off-white"
                />
                Only these
              </label>
            </div>
            {!everyKind && (
              <div className="flex flex-wrap gap-4 pt-1">
                {TARGET_KINDS.map((kind) => (
                  <label
                    key={kind}
                    className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone"
                  >
                    <Checkbox
                      checked={appliesTo.includes(kind)}
                      onCheckedChange={() => toggleKind(kind)}
                    />
                    {TARGET_KIND_LABEL[kind]}
                  </label>
                ))}
              </div>
            )}
            {problems.appliesTo && (
              <p className="text-body-sm text-traffic-red">
                {problems.appliesTo}
              </p>
            )}
            <p className="max-w-[80ch] text-body-sm text-bone-gray">
              The cluster is never implied — &ldquo;every workload kind&rdquo;
              means workloads. Tick the cluster, and only it, to ask this about
              the cluster itself.
            </p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-body-sm font-medium text-warm-off-white">
              Only for these technologies
              <span className="ml-1.5 font-normal text-bone-gray">optional</span>
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {WORKLOAD_TECHNOLOGIES.map((technology) => (
                <label
                  key={technology}
                  className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone"
                >
                  <Checkbox
                    checked={appliesToTechnologies.includes(technology)}
                    onCheckedChange={() =>
                      toggleTechnology(technology, setAppliesToTechnologies)
                    }
                  />
                  {TECHNOLOGY_LABEL[technology]}
                </label>
              ))}
            </div>
            <p className="max-w-[80ch] text-body-sm text-bone-gray">
              Leave all unchecked for a technology-agnostic check. Ticking every
              box is <em>not</em> the same as leaving them empty: empty also
              reaches workloads whose technology was never identified, which a
              check written for a specific engine should not do.
            </p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-body-sm font-medium text-warm-off-white">
              Never for these technologies
              <span className="ml-1.5 font-normal text-bone-gray">optional</span>
            </legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {WORKLOAD_TECHNOLOGIES.map((technology) => (
                <label
                  key={technology}
                  className="flex cursor-pointer items-center gap-2 text-body-sm text-pale-stone"
                >
                  <Checkbox
                    checked={excludesTechnologies.includes(technology)}
                    onCheckedChange={() =>
                      toggleTechnology(technology, setExcludesTechnologies)
                    }
                  />
                  {TECHNOLOGY_LABEL[technology]}
                </label>
              ))}
            </div>
            {problems.technologies && (
              <p className="text-body-sm text-traffic-red">
                {problems.technologies}
              </p>
            )}
            <p className="max-w-[80ch] text-body-sm text-bone-gray">
              Suppress this check where its generic form is a false positive, or
              where a technology-specific check already asks it better —
              otherwise both fire and one problem opens two concerns.
            </p>
          </fieldset>
        </Disclosure>

        <Disclosure
          label="Tuning"
          summary={[
            requires
              ? `needs ${requirementLabel(requires as CheckRequirement)}`
              : "answerable from the cluster itself",
            Number(absentRuns) > 1
              ? `auto-resolves after ${absentRuns} clean runs`
              : null,
            reference || null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="check-requires"
              label="Needs extra telemetry?"
              description={
                requires
                  ? `Needs ${REQUIREMENT_LABEL[requires as CheckRequirement]}. Where that is unavailable Holmes must SKIP this check — never pass it.`
                  : "Leave as-is for anything answerable from the cluster's own objects. Naming a dependency is what allows the check to be skipped honestly instead of passing on missing data."
              }
            >
              {(props) => (
                <select
                  {...props}
                  value={requires}
                  onChange={(e) => setRequires(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="" className="bg-popover">
                    No — answerable from the cluster itself
                  </option>
                  {CHECK_REQUIREMENTS.map((value) => (
                    <option key={value} value={value} className="bg-popover">
                      {requirementLabel(value)}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              id="check-absent"
              label="Clean runs before auto-resolving"
              error={problems.absentRuns}
              description="How many consecutive runs must evaluate this check WITHOUT it failing before an open concern closes itself. Use 2 or more for anything metric-driven, which naturally flaps."
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={CHECK_LIMITS.absentRuns.min}
                  max={CHECK_LIMITS.absentRuns.max}
                  value={absentRuns}
                  onChange={(e) => setAbsentRuns(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field
            id="check-reference"
            label="Cites"
            optional
            error={problems.reference}
            value={reference}
            limit={CHECK_LIMITS.reference}
            description="The standard or policy this comes from — what makes the severity defensible when someone disagrees with it."
          >
            {(props) => (
              <Input
                {...props}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="kubescape C-0263 · internal policy SEC-14"
                autoComplete="off"
              />
            )}
          </Field>
        </Disclosure>
      </DialogBody>

      <ModalFooter>
        <Button type="submit" disabled={busy || invalid || (editing && !dirty)}>
          {busy ? "Saving…" : editing ? "Save check" : "Create check"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        {editing && dirty && (
          <span className="text-body-sm text-bone-gray">
            {invalid ? "Not saveable yet" : "Unsaved changes"}
          </span>
        )}
      </ModalFooter>
    </form>
  );
}
