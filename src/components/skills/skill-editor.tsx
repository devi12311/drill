"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StickyBar } from "@/components/ui/sticky-bar";
import { Textarea } from "@/components/ui/textarea";
import { useLeaveGuard } from "@/components/ui/use-leave-guard";
import { SkillDrafter } from "./skill-drafter";
import { HolmesChange, type DraftField } from "./holmes-change";
import { SkillInputRows, inputRowId, labelForKey } from "./skill-input-rows";
import { PROCEDURE_ID, SkillProcedureField } from "./skill-procedure-field";
import { HttpError, sendJson } from "@/lib/http";
import { SKILL_SEED_KEY } from "@/lib/skills/conversation-steps";
import {
  SKILL_LIMITS,
  hasProblems,
  validateSkillDraft,
  skillDraftProblems,
  toSkillDraft,
  toSkillName,
  unusedInputs,
  type SkillDraft,
  type SkillInput,
  type SkillView,
} from "@/lib/skills/types";

const EMPTY: SkillDraft = { name: "", description: "", body: "", inputs: [] };

const FIELD_LABELS: Record<DraftField, string> = {
  name: "name",
  description: "description",
  inputs: "inputs",
  body: "procedure",
};

const FIELD_IDS: Record<Exclude<DraftField, "inputs">, string> = {
  name: "skill-name",
  description: "skill-description",
  body: PROCEDURE_ID,
};

// Field by field rather than JSON.stringify: inputs come back from jsonb, which
// does not keep object key order (docs/DECISIONS.md, 79).
function sameInputs(a: SkillInput[], b: SkillInput[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => x.key === b[i].key && x.label === b[i].label && x.required === b[i].required)
  );
}

function changedFields(a: SkillDraft, b: SkillDraft): DraftField[] {
  const changed: DraftField[] = [];
  if (a.name !== b.name) changed.push("name");
  if (a.description !== b.description) changed.push("description");
  if (!sameInputs(a.inputs, b.inputs)) changed.push("inputs");
  if (a.body !== b.body) changed.push("body");
  return changed;
}

const noSubscription = () => () => {};
const readSeed = () => sessionStorage.getItem(SKILL_SEED_KEY);
const noSeed = () => null;

/** A stale or tampered seed is just not offered; the form stays blank. */
function parseSeed(raw: string): SkillDraft | null {
  try {
    return validateSkillDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

function listOf(words: string[]): string {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Into view below the sticky bar, then focused — `focus()` alone can leave it under the bar. */
function reveal(id: string) {
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: "center" });
  el?.focus({ preventScroll: true });
}

/**
 * Editing a shared skill before importing a copy (`/share/<token>`). The form
 * is the same one; only where it starts and where it saves differ, so the review
 * page owns the target org, and the editor owns the fields.
 */
export interface SkillImport {
  kind: "share";
  draft: SkillDraft;
  /** A name the target org already uses — marked on the field before Import fails. */
  takenName: string | null;
  submitLabel: string;
  /** Why Import is off for this target (already imported there), shown in its place. */
  blockedReason: string | null;
  /** In the bar, beside the import button: the target-org picker. */
  actions: ReactNode;
  submit: (draft: SkillDraft) => Promise<void>;
}

/**
 * Where a new skill's form starts: blank, a draft handed over in sessionStorage
 * — the chat's skill builder (`?from=conversation`, marked as Holmes's) or a
 * duplicated skill (`?from=duplicate`) — or a shared skill under review.
 */
export type SkillSource = { kind: "conversation" } | { kind: "duplicate" } | SkillImport;

/**
 * Create (`skill` null) or edit one skill — only editing: reading a skill and
 * deciding who uses it happen on its page (`SkillDetail`), so this form has one
 * way to save. Each field is checked with the same rules the API runs
 * (`skillDraftProblems` shares them with `validateSkillDraft`), so a save only
 * fails for reasons the form could not know — a taken name, a lost permission.
 *
 * The decision lives in a bar pinned to the top: Save and whatever blocks it
 * stay in view however long the procedure is.
 */
export function SkillEditor({
  skill,
  source,
  askHolmes = false,
  onSaved,
  onCancel,
}: {
  skill: SkillView | null;
  source?: SkillSource;
  /** Open with the Holmes drafter showing ("Describe it to Holmes"). */
  askHolmes?: boolean;
  /** An existing skill was saved; a new one navigates to its own page instead. */
  onSaved?: (skill: SkillView) => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const importing = source?.kind === "share" ? source : null;
  // What the server holds. Moves forward on save, so "unsaved" is always
  // measured against the last save, not against the page load. Under review,
  // the shared version: "changed" then means "your copy will differ from it".
  const [saved, setSaved] = useState<SkillDraft>(() =>
    importing ? importing.draft : skill ? toSkillDraft(skill) : EMPTY,
  );
  const [draft, setDraft] = useState<SkillDraft>(saved);
  const [preview, setPreview] = useState(false);
  const [holmesOpen, setHolmesOpen] = useState(askHolmes && !importing);
  // The form before the last Holmes draft replaced it — per-field revert and Undo all.
  const [beforeDraft, setBeforeDraft] = useState<SkillDraft | null>(null);
  const [holmesFields, setHolmesFields] = useState<DraftField[]>([]);
  const [visited, setVisited] = useState<Set<DraftField>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A name the server refused as taken since this form opened.
  const [refusedName, setRefusedName] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState(false);

  const problems = useMemo(() => skillDraftProblems(draft), [draft]);
  const blocked = hasProblems(problems);
  const dirtyFields = changedFields(draft, saved);
  const dirty = dirtyFields.length > 0;
  // Untouched, a shared skill is still worth importing as it is.
  const submittable = importing ? !blocked && !importing.blockedReason : dirty && !blocked;
  useLeaveGuard(dirty && !saving);

  // A draft handed over in sessionStorage. Read through an external store so the
  // server render (which has no sessionStorage) and hydration agree, then applied
  // during render — once per seed — and removed so a reload is a blank form.
  const seeding =
    skill === null && (source?.kind === "conversation" || source?.kind === "duplicate")
      ? source.kind
      : null;
  const seed = useSyncExternalStore(noSubscription, readSeed, noSeed);
  const [appliedSeed, setAppliedSeed] = useState<string | null>(null);
  if (seeding && seed && seed !== appliedSeed) {
    setAppliedSeed(seed);
    const next = parseSeed(seed);
    if (next) {
      // The skill builder's draft is Holmes's work, reviewed like any other; a
      // duplicate is the author's own copy.
      if (seeding === "conversation") {
        setBeforeDraft(EMPTY);
        setHolmesFields(changedFields(next, EMPTY));
      }
      setDraft(next);
    }
  }
  useEffect(() => {
    if (appliedSeed) sessionStorage.removeItem(SKILL_SEED_KEY);
  }, [appliedSeed]);

  // A blank new form is not wrong yet: a field complains once it has been left,
  // or once it holds something. An existing or handed-over skill is judged at once.
  const judged = skill !== null || importing !== null || appliedSeed !== null;
  const shows = (field: DraftField, hasValue: boolean) =>
    judged || visited.has(field) || hasValue;
  const nameTaken =
    importing?.takenName === draft.name
      ? `Your organization already has a skill named "${draft.name}" — rename this copy.`
      : refusedName === draft.name
        ? `Your organization already has a skill named "${draft.name}" — choose another name.`
        : undefined;
  const fieldError = (field: Exclude<DraftField, "inputs">) =>
    (field === "name" && nameTaken) ||
    (shows(field, draft[field] !== "") ? problems[field] : undefined);
  const rowErrors = Object.fromEntries(
    Object.entries(problems.inputs).filter(
      ([i]) => judged || draft.inputs[Number(i)]?.key !== "",
    ),
  );
  const visit = (field: DraftField) => () =>
    setVisited((v) => (v.has(field) ? v : new Set(v).add(field)));

  // In form order, so "N problems ↑" lands on the first one.
  const problemIds = [
    ...(["name", "description"] as const).filter((f) => fieldError(f)).map((f) => FIELD_IDS[f]),
    ...Object.keys(rowErrors).map((i) => inputRowId(Number(i))),
    ...(fieldError("body") ? [FIELD_IDS.body] : []),
  ];

  function showFirstProblem() {
    const id = problemIds[0];
    if (!id) return;
    if (id === FIELD_IDS.body && preview) {
      setPreview(false);
      requestAnimationFrame(() => reveal(id));
    } else reveal(id);
  }

  /** A Holmes draft fills the form; each field it changed is marked, with its own revert. */
  function applyHolmesDraft(next: SkillDraft) {
    setBeforeDraft(draft);
    setHolmesFields(changedFields(next, draft));
    setDraft(next);
    setHolmesOpen(false);
  }

  function revertField(field: DraftField) {
    if (!beforeDraft) return;
    setDraft((d) => ({ ...d, [field]: beforeDraft[field] }));
    const rest = holmesFields.filter((f) => f !== field);
    setHolmesFields(rest);
    if (rest.length === 0) setBeforeDraft(null);
  }

  function undoHolmes() {
    if (beforeDraft) setDraft(beforeDraft);
    setBeforeDraft(null);
    setHolmesFields([]);
  }

  const unused = unusedInputs(draft);
  const update = (patch: Partial<SkillDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const hasContent = Boolean(draft.name || draft.description || draft.body || draft.inputs.length);
  const renamed = skill !== null && draft.name !== saved.name;
  const holmesMark = (field: DraftField) =>
    beforeDraft && holmesFields.includes(field) ? (
      <HolmesChange
        field={field}
        before={beforeDraft}
        after={draft}
        onRevert={() => revertField(field)}
      />
    ) : null;

  async function save() {
    if (saving || !submittable || nameTaken) return;
    setSaving(true);
    setError(null);
    try {
      if (importing) {
        await importing.submit(draft);
        return;
      }
      const result = skill
        ? await sendJson<SkillView>(`/api/skills/${skill.id}`, draft, "PATCH")
        : await sendJson<SkillView>("/api/skills", draft);
      // Clean before leaving, so the leave guard has nothing to ask about.
      const next = toSkillDraft(result);
      setSaved(next);
      setDraft(next);
      setBeforeDraft(null);
      setHolmesFields([]);
      // A new skill's page is where it is shared and run from.
      if (skill) onSaved?.(result);
      else router.replace(`/skills/${result.id}`);
    } catch (err) {
      if (err instanceof HttpError && err.status === 409) {
        setRefusedName(draft.name);
        reveal(FIELD_IDS.name);
      } else setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  // ⌘S / Ctrl+S saves, the editor-wide habit. Read through a ref so the
  // listener is attached once and still calls this render's `save`.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const cancel = () => (dirty ? setDiscarding(true) : onCancel());

  const status = error ? (
    <span className="text-traffic-red">{error}</span>
  ) : importing?.blockedReason ? (
    <span className="text-bone-gray">{importing.blockedReason}</span>
  ) : problemIds.length > 0 ? (
    <button
      type="button"
      onClick={showFirstProblem}
      className="inline-flex items-center gap-1 text-traffic-red underline-offset-2 outline-none hover:underline focus-visible:underline"
    >
      {problemIds.length === 1 ? "1 problem" : `${problemIds.length} problems`} to fix
      <ArrowUp className="size-3.5" />
    </button>
  ) : blocked ? (
    <span className="text-bone-gray">
      Fill in the name, description and procedure to {importing ? "import" : skill ? "save" : "create"} it.
    </span>
  ) : dirty && importing ? (
    <span className="text-pale-stone">Edited — your copy will differ from the shared one.</span>
  ) : dirty ? (
    <span className="inline-flex items-center gap-2 text-pale-stone">
      <span className="size-1.5 rounded-full bg-pale-stone" />
      Unsaved: {listOf(dirtyFields.map((f) => FIELD_LABELS[f]))}
    </span>
  ) : importing ? (
    <span className="text-bone-gray">Unchanged — imports exactly as shared.</span>
  ) : skill ? (
    <span className="text-bone-gray">No changes yet</span>
  ) : null;

  return (
    <div className="space-y-8">
      <StickyBar>
        <div className="min-w-48 flex-1">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-body-sm text-warm-off-white">
              {importing ? "Editing your copy" : skill ? "Editing" : "New skill"}
            </span>
            {skill && (
              <span className="truncate font-mono text-body-sm text-bone-gray">{saved.name}</span>
            )}
          </div>
          <p aria-live="polite" className="min-h-5 text-body-sm">
            {saving ? <span className="text-bone-gray">{importing ? "Importing…" : "Saving…"}</span> : status}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {!importing && (
            <Button
              variant="ghost"
              size="sm"
              aria-expanded={holmesOpen}
              onClick={() => setHolmesOpen((v) => !v)}
            >
              <Sparkles className="size-4" />
              Ask Holmes
            </Button>
          )}
          {importing?.actions}
          <Button variant="secondary" size="sm" onClick={cancel} disabled={saving}>
            {importing ? "Back to review" : "Cancel"}
          </Button>
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={saving || !submittable || Boolean(nameTaken)}
            title="⌘S"
          >
            {importing ? importing.submitLabel : skill ? "Save" : "Create skill"}
          </Button>
        </div>
      </StickyBar>

      {(holmesOpen || beforeDraft) && (
        <div className="max-w-[820px] space-y-2">
          {holmesOpen && (
            <SkillDrafter
              current={hasContent ? draft : null}
              onDraft={applyHolmesDraft}
              onClose={() => setHolmesOpen(false)}
            />
          )}
          {beforeDraft && (
            <p className="text-body-sm text-bone-gray">
              {holmesFields.length
                ? `Holmes wrote the ${listOf(holmesFields.map((f) => FIELD_LABELS[f]))} — review each marked field below.`
                : "Holmes's draft matched the form — nothing changed."}{" "}
              <button
                type="button"
                onClick={undoHolmes}
                className="text-pale-stone underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
              >
                Undo all
              </button>
            </p>
          )}
        </div>
      )}

      <div className="max-w-[820px] space-y-8">
        <FieldGroup
          title="What Holmes sees in its catalog"
          purpose="Holmes picks a skill by its description alone — make it specific, or it gets fetched for unrelated problems."
        >
          <Field
            id={FIELD_IDS.name}
            label="Name"
            description={
              renamed ? (
                <>
                  Holmes fetches skills by name. After saving,{" "}
                  <span className="font-mono">{saved.name}</span> no longer exists — earlier
                  chats that mention it will point at nothing.
                </>
              ) : (
                "Lowercase letters, digits and hyphens. Holmes passes it back to fetch the skill."
              )
            }
            error={fieldError("name")}
          >
            {(props) => (
              <Input
                {...props}
                value={draft.name}
                onChange={(e) => update({ name: toSkillName(e.target.value) })}
                onBlur={visit("name")}
                placeholder="checkout-latency-investigation"
                className="font-mono text-[13px]"
              />
            )}
          </Field>
          {holmesMark("name")}
          <Field
            id={FIELD_IDS.description}
            label="Description"
            description="When should Holmes use this? Name the symptom and the inputs it starts from."
            value={draft.description}
            limit={SKILL_LIMITS.description}
            error={fieldError("description")}
          >
            {(props) => (
              <Textarea
                {...props}
                value={draft.description}
                onChange={(e) => update({ description: e.target.value })}
                onBlur={visit("description")}
                rows={3}
              />
            )}
          </Field>
          {holmesMark("description")}
        </FieldGroup>

        <FieldGroup
          title="Inputs"
          purpose="What you fill in when you run the skill. Name each one; the procedure uses it as {{key}}."
        >
          <SkillInputRows
            inputs={draft.inputs}
            onChange={(inputs) => update({ inputs })}
            errors={rowErrors}
          />
          {unused.length > 0 && (
            <p className="text-body-sm text-bone-gray">
              Not used in the procedure: {unused.map((k) => `{{${k}}}`).join(", ")}
            </p>
          )}
          {holmesMark("inputs")}
        </FieldGroup>
      </div>

      <FieldGroup title="Procedure" purpose="Steps Holmes follows in order, naming the toolsets to use.">
        <SkillProcedureField
          value={draft.body}
          onChange={(body) => update({ body })}
          onBlur={visit("body")}
          error={fieldError("body")}
          label="Steps"
          inputKeys={draft.inputs.map((i) => i.key).filter(Boolean)}
          onAddInput={(key) => {
            if (draft.inputs.length >= SKILL_LIMITS.inputs) return;
            update({
              inputs: [...draft.inputs, { key, label: labelForKey(key), required: false }],
            });
          }}
          preview={preview}
          onPreview={setPreview}
        />
        {holmesMark("body")}
      </FieldGroup>

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard your changes?"
        description={`Your edits to the ${listOf(dirtyFields.map((f) => FIELD_LABELS[f]))} are not saved.`}
        confirmLabel="Discard"
        destructive
        onConfirm={onCancel}
      />
    </div>
  );
}
