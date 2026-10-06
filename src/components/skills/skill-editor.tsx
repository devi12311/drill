"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLeaveGuard } from "@/components/ui/use-leave-guard";
import { Markdown } from "@/components/chat/markdown";
import { useSession } from "@/components/session/session-provider";
import { SkillDrafter } from "./skill-drafter";
import { cn } from "@/lib/utils";
import {
  SKILL_LIMITS,
  hasProblems,
  skillDraftProblems,
  toInputKey,
  toSkillName,
  unusedInputs,
  type SkillDraft,
  type SkillInput,
  type SkillView,
} from "@/lib/skills/types";

const EMPTY: SkillDraft = { name: "", description: "", body: "", inputs: [] };

type DraftField = "name" | "description" | "inputs" | "body";
const FIELD_LABELS: Record<DraftField, string> = {
  name: "name",
  description: "description",
  inputs: "inputs",
  body: "procedure",
};

async function send(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
  return json;
}

function toDraft(skill: SkillView | null): SkillDraft {
  return skill
    ? { name: skill.name, description: skill.description, body: skill.body, inputs: skill.inputs }
    : EMPTY;
}

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

function listOf(words: string[]): string {
  return words.length < 2
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Marks a field the last Holmes draft rewrote, until it is saved or undone. */
function HolmesMark({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-2 rounded-sm bg-smoke-charcoal px-1.5 py-0.5 text-caption-tracked font-normal uppercase text-pale-stone">
      Holmes
    </span>
  );
}

function InputRows({
  inputs,
  onChange,
  disabled,
  errors,
}: {
  inputs: SkillInput[];
  onChange: (inputs: SkillInput[]) => void;
  disabled: boolean;
  /** Row index → that row's problem, already filtered to what is worth showing. */
  errors: Record<number, string>;
}) {
  const set = (i: number, patch: Partial<SkillInput>) =>
    onChange(inputs.map((input, idx) => (idx === i ? { ...input, ...patch } : input)));
  return (
    <div className="space-y-3">
      {inputs.map((input, i) => (
        <div key={i} className="space-y-1">
          {/* Two lines on a phone: key and label each need their full width. */}
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <Input
              value={input.key}
              onChange={(e) => set(i, { key: toInputKey(e.target.value) })}
              placeholder="service_name"
              aria-label={`Input ${i + 1} key`}
              aria-invalid={errors[i] ? true : undefined}
              aria-describedby={errors[i] ? `skill-input-${i}-error` : undefined}
              disabled={disabled}
              className="w-full font-mono text-[13px] sm:w-48"
            />
            <Input
              value={input.label}
              onChange={(e) => set(i, { label: e.target.value })}
              placeholder="Service name"
              aria-label={`Input ${i + 1} label`}
              disabled={disabled}
              className="min-w-0 flex-1"
            />
            <label className="flex h-11 shrink-0 items-center gap-2 text-body-sm text-pale-stone sm:h-auto">
              <Checkbox
                checked={input.required}
                onCheckedChange={(v) => set(i, { required: v === true })}
                disabled={disabled}
              />
              required
            </label>
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove input ${input.key || i + 1}`}
                onClick={() => onChange(inputs.filter((_, idx) => idx !== i))}
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-bone-gray outline-none hover:text-traffic-red focus-visible:ring-3 focus-visible:ring-ring/50 sm:size-8"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          {errors[i] && (
            <p id={`skill-input-${i}-error`} className="text-body-sm text-traffic-red">
              {errors[i]}
            </p>
          )}
        </div>
      ))}
      {!disabled && inputs.length < SKILL_LIMITS.inputs && (
        <button
          type="button"
          onClick={() => onChange([...inputs, { key: "", label: "", required: false }])}
          className="flex items-center gap-1.5 rounded-sm px-1 py-0.5 text-body-sm text-bone-gray outline-none hover:text-warm-off-white focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Plus className="size-3.5" />
          add input
        </button>
      )}
    </div>
  );
}

/** Write / Preview, as a real tab set: announced, selected state, arrow keys. */
function ProcedureTabs({
  preview,
  onPreview,
}: {
  preview: boolean;
  onPreview: (preview: boolean) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const tabs = ["Write", "Preview"] as const;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const next = preview ? 0 : 1;
    onPreview(next === 1);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label="Procedure view" className="flex gap-1" onKeyDown={onKeyDown}>
      {tabs.map((tab, i) => {
        const selected = preview === (i === 1);
        return (
          <button
            key={tab}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`skill-tab-${tab.toLowerCase()}`}
            aria-selected={selected}
            aria-controls="skill-procedure-panel"
            tabIndex={selected ? 0 : -1}
            onClick={() => onPreview(i === 1)}
            className={cn(
              "rounded-sm px-2.5 py-1 text-body-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              selected
                ? "bg-iron-veil text-warm-off-white"
                : "text-bone-gray hover:text-warm-off-white",
            )}
          >
            {tab}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Create (`skill` null) or edit one skill. Each field is checked with the same
 * rules the API runs (`skillDraftProblems` shares them with `validateSkillDraft`),
 * so a save only fails for reasons the form could not know (a taken name, a lost
 * permission) — and every other problem is shown beside its own field.
 */
export function SkillEditor({ skill }: { skill: SkillView | null }) {
  const router = useRouter();
  const { user } = useSession();
  // What the server holds. Moves forward on save, so "unsaved" is always
  // measured against the last save, not against the page load.
  const [saved, setSaved] = useState<SkillDraft>(() => toDraft(skill));
  const [draft, setDraft] = useState<SkillDraft>(saved);
  const [preview, setPreview] = useState(false);
  // The form before the last Holmes draft replaced it — one step of undo.
  const [beforeDraft, setBeforeDraft] = useState<SkillDraft | null>(null);
  const [holmesFields, setHolmesFields] = useState<DraftField[]>([]);
  const [visited, setVisited] = useState<Set<DraftField>>(new Set());
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopeStatus, setScopeStatus] = useState<"saving" | "saved" | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);
  const readOnly = skill !== null && !skill.editable;
  // Sharing is an org admin's call, and needs a saved skill to act on.
  const canShare = user.isOrgAdmin && skill !== null;

  const problems = useMemo(() => skillDraftProblems(draft), [draft]);
  const blocked = hasProblems(problems);
  const dirty = changedFields(draft, saved).length > 0;
  useLeaveGuard(dirty && !saving && !readOnly);

  // A blank new form is not wrong yet: a field complains once it has been left,
  // or once it holds something. An existing skill is judged from the start.
  const shows = (field: DraftField, hasValue: boolean) =>
    !readOnly && (skill !== null || visited.has(field) || hasValue);
  const fieldError = (field: Exclude<DraftField, "inputs">) =>
    shows(field, draft[field] !== "") ? problems[field] : undefined;
  const rowErrors = Object.fromEntries(
    Object.entries(problems.inputs).filter(
      ([i]) => skill !== null || draft.inputs[Number(i)]?.key !== "",
    ),
  );
  const visit = (field: DraftField) => () =>
    setVisited((v) => (v.has(field) ? v : new Set(v).add(field)));

  const unused = unusedInputs(draft);
  const update = (patch: Partial<SkillDraft>) => {
    setJustSaved(false);
    setDraft((d) => ({ ...d, ...patch }));
  };
  const hasContent = Boolean(draft.name || draft.description || draft.body || draft.inputs.length);
  const renamed = skill !== null && draft.name !== saved.name;
  // Only what is marked on screen; an untouched new form is "incomplete", not wrong.
  const shownProblems =
    (["name", "description", "body"] as const).filter((f) => fieldError(f)).length +
    Object.keys(rowErrors).length;

  async function run(action: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setSaving(false);
    }
  }

  const save = () =>
    run(async () => {
      const result: SkillView = skill
        ? await send("PATCH", `/api/skills/${skill.id}`, draft)
        : await send("POST", "/api/skills", draft);
      // The server trims; take its copy so the form is not "changed" by a space.
      const next = toDraft(result);
      setSaved(next);
      setDraft(next);
      setBeforeDraft(null);
      setHolmesFields([]);
      setJustSaved(true);
      if (!skill) router.replace(`/skills/${result.id}`);
      router.refresh();
    });

  // These save on their own, so they report on their own, beside the checkbox.
  const setScope = async (patch: { visibility?: "private" | "shared"; alwaysOn?: boolean }) => {
    setScopeStatus("saving");
    setScopeError(null);
    try {
      await send("PATCH", `/api/skills/${skill!.id}`, patch);
      setScopeStatus("saved");
      router.refresh();
    } catch (err) {
      setScopeStatus(null);
      setScopeError(err instanceof Error ? err.message : "Request failed");
    }
  };

  const remove = () =>
    run(async () => {
      await send("DELETE", `/api/skills/${skill!.id}`);
      router.push("/skills");
    });

  return (
    <div className="space-y-8">
      {!readOnly && (
        <div className="space-y-2">
          <SkillDrafter
            startOpen={skill === null}
            current={hasContent ? draft : null}
            onDraft={(next) => {
              setBeforeDraft(draft);
              setHolmesFields(changedFields(next, draft));
              setJustSaved(false);
              setDraft(next);
            }}
          />
          {beforeDraft && (
            <p className="text-body-sm text-bone-gray">
              {holmesFields.length
                ? `Holmes rewrote the ${listOf(holmesFields.map((f) => FIELD_LABELS[f]))} — review before saving.`
                : "Holmes's draft matched the form — nothing changed."}{" "}
              <button
                type="button"
                onClick={() => {
                  setDraft(beforeDraft);
                  setBeforeDraft(null);
                  setHolmesFields([]);
                }}
                className="text-pale-stone underline-offset-2 outline-none hover:text-warm-off-white hover:underline focus-visible:underline"
              >
                Undo
              </button>
            </p>
          )}
        </div>
      )}

      {readOnly && (
        <p className="rounded-lg border border-border bg-smoked-onyx px-4 py-3 text-body-sm text-pale-stone">
          This skill is shared with your whole org, so only an org admin can change it.
        </p>
      )}

      <FieldGroup title="What Holmes sees in its catalog" purpose="Holmes picks a skill by its description alone — make it specific, or it gets fetched for unrelated problems.">
        <Field
          id="skill-name"
          label={<>Name<HolmesMark show={holmesFields.includes("name")} /></>}
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
              disabled={readOnly}
              className="font-mono text-[13px]"
            />
          )}
        </Field>
        <Field
          id="skill-description"
          label={<>Description<HolmesMark show={holmesFields.includes("description")} /></>}
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
              disabled={readOnly}
            />
          )}
        </Field>
      </FieldGroup>

      <FieldGroup
        title="Inputs"
        purpose={
          <>
            Values you fill in when you run the skill from the composer. Reference them in the
            procedure as {"{{key}}"}.
            <HolmesMark show={holmesFields.includes("inputs")} />
          </>
        }
      >
        <InputRows
          inputs={draft.inputs}
          onChange={(inputs) => update({ inputs })}
          disabled={readOnly}
          errors={rowErrors}
        />
        {unused.length > 0 && (
          <p className="text-body-sm text-bone-gray">
            Not used in the procedure: {unused.map((k) => `{{${k}}}`).join(", ")}
          </p>
        )}
      </FieldGroup>

      <FieldGroup title="Procedure" purpose="Markdown. Steps Holmes follows in order, naming the toolsets to use.">
        <ProcedureTabs preview={preview} onPreview={setPreview} />
        <div
          id="skill-procedure-panel"
          role="tabpanel"
          aria-labelledby={preview ? "skill-tab-preview" : "skill-tab-write"}
        >
          {preview ? (
            <div className="min-h-64 rounded-lg border border-border px-4 py-3">
              <Markdown>{draft.body || "_Nothing written yet._"}</Markdown>
            </div>
          ) : (
            <Field
              id="skill-body"
              label={<>Steps<HolmesMark show={holmesFields.includes("body")} /></>}
              value={draft.body}
              limit={SKILL_LIMITS.body}
              error={fieldError("body")}
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={draft.body}
                  onChange={(e) => update({ body: e.target.value })}
                  onBlur={visit("body")}
                  rows={22}
                  disabled={readOnly}
                  className="font-mono text-[13px] leading-relaxed"
                />
              )}
            </Field>
          )}
        </div>
      </FieldGroup>

      {canShare && (
        <FieldGroup
          title="Sharing"
          purpose="Org admins only, and saved as soon as you tick a box — not with the form. A shared skill reaches every member's investigations; always-on puts its whole procedure in every chat turn's system prompt."
        >
          <label className="flex items-center gap-2.5 text-body-sm text-pale-stone">
            <Checkbox
              checked={skill.visibility === "shared"}
              onCheckedChange={(v) => setScope({ visibility: v === true ? "shared" : "private" })}
              disabled={scopeStatus === "saving"}
            />
            Shared with all users
          </label>
          <div className="space-y-1">
            <label className="flex items-center gap-2.5 text-body-sm text-pale-stone">
              <Checkbox
                checked={skill.alwaysOn}
                onCheckedChange={(v) => setScope({ alwaysOn: v === true })}
                disabled={scopeStatus === "saving" || skill.visibility !== "shared"}
              />
              Always-on team instruction
              <span className="text-bone-gray">— costs its full length in tokens on every turn</span>
            </label>
            {skill.visibility !== "shared" && (
              <p className="pl-[26px] text-[12px] text-bone-gray">
                Share it first — always-on applies to everyone&apos;s turns.
              </p>
            )}
          </div>
          <p aria-live="polite" className="min-h-5 text-body-sm">
            {scopeError ? (
              <span className="text-traffic-red">{scopeError}</span>
            ) : scopeStatus === "saving" ? (
              <span className="text-bone-gray">Saving…</span>
            ) : scopeStatus === "saved" ? (
              <span className="inline-flex items-center gap-1.5 text-bone-gray">
                <Check className="size-3.5 text-prompt-green" />
                Sharing saved
              </span>
            ) : null}
          </p>
        </FieldGroup>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-5">
        <p aria-live="polite" className="min-w-0 text-body-sm">
          {readOnly ? null : error ? (
            <span className="text-traffic-red">{error}</span>
          ) : dirty && blocked ? (
            <span className="text-bone-gray">
              {shownProblems === 0
                ? "Fill in the empty fields — name, description, procedure and any input keys — to create it."
                : `Fix ${shownProblems === 1 ? "the field" : `${shownProblems} fields`} marked above to save.`}
            </span>
          ) : dirty ? (
            <span className="inline-flex items-center gap-2 text-pale-stone">
              <span className="size-1.5 rounded-full bg-gold-leaf" />
              Unsaved changes
            </span>
          ) : justSaved ? (
            <span className="inline-flex items-center gap-1.5 text-bone-gray">
              <Check className="size-3.5 text-prompt-green" />
              Saved
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {skill?.editable && (
            <ConfirmButton
              label="Delete skill"
              title={`Delete ${skill.name}?`}
              description="Investigations stop seeing it immediately. Past answers that used it keep their record."
              confirmLabel="Delete"
              destructive
              variant="ghost"
              disabled={saving}
              onConfirm={remove}
            >
              Delete
            </ConfirmButton>
          )}
          {!readOnly && (
            <Button onClick={save} disabled={saving || blocked || !dirty}>
              {saving ? "Saving…" : skill ? "Save" : "Create skill"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
