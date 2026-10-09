"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useLeaveGuard } from "@/components/ui/use-leave-guard";
import { useShortcut } from "@/components/shell/shortcuts";
import { SHORTCUTS } from "@/lib/shortcuts";
import type { ChatEntry } from "@/lib/chat/types";
import {
  askedQuestions,
  MAX_SKILL_STEPS,
  SKILL_SEED_KEY,
  conversationCalls,
  detectInputValues,
  inputLabel,
  isAddableStep,
  templateValues,
  type ConversationStep,
} from "@/lib/skills/conversation-steps";
import { SKILL_LIMITS, checkInput, type SkillDraft } from "@/lib/skills/types";

/**
 * "Turn into skill": picking a conversation's decisive calls, confirming which
 * of the question's values become inputs, and having Holmes draft the skill
 * (docs/DECISIONS.md — "Skills from conversations"). One state for the whole
 * chat: the rows, the messages and the rail (in its aside or its narrow-screen
 * dialog) all read it through `SkillBuilderContext`.
 */

interface PickedStep extends ConversationStep {
  number: number;
}

/** An input row: detected from the questions, or added by hand. */
export interface InputRow {
  id: string;
  /** What this conversation used — empty for a hand-added input without one. */
  value: string;
  key: string;
  enabled: boolean;
  detected: boolean;
  /** Detected rows: the picked steps that reuse the value. */
  steps: number[];
}

type Phase =
  | { name: "idle" }
  | { name: "generating"; startedAt: number }
  | { name: "error"; message: string };

const FLASH_MS = 1200;

export function useSkillBuilderState(entries: ChatEntry[], conversationId: string | null) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [pickedKeys, setPickedKeys] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Author edits to detected rows, keyed by value — they survive re-detection.
  const [overrides, setOverrides] = useState<Record<string, { key?: string; enabled?: boolean }>>({});
  const [custom, setCustom] = useState<{ id: string; value: string; key: string }[]>([]);
  // null until the author types: then the purpose is theirs, not re-synced.
  const [purposeEdited, setPurposeEdited] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const pending = useRef<AbortController | null>(null);
  // Narrow screens: the rail is a dialog the author opens once picking is done.
  const [reviewOpen, setReviewOpen] = useState(false);

  const calls = useMemo(
    () =>
      conversationCalls(
        entries
          .filter((e) => e.role === "assistant")
          .map((e) => ({ id: e.id, toolCalls: e.response?.tool_calls ?? [] })),
      ),
    [entries],
  );
  const addable = useMemo(() => calls.filter((c) => isAddableStep(c.call)), [calls]);
  const picked: PickedStep[] = useMemo(
    () =>
      addable
        .filter((c) => pickedKeys.has(c.key))
        .map((c, i) => ({ ...c, number: i + 1 })),
    [addable, pickedKeys],
  );
  const numbers = useMemo(() => new Map(picked.map((p) => [p.key, p.number])), [picked]);

  const asked = useMemo(
    () =>
      askedQuestions(
        entries.map((e) => ({
          role: e.role,
          text: e.ask ?? "",
          pendingApprovals: e.response?.pending_approvals,
          skillRun: !!e.skill,
        })),
      ),
    [entries],
  );
  const questions = useMemo(() => asked.map((q) => q.text), [asked]);
  const detected = useMemo(() => detectInputValues(questions, picked), [questions, picked]);

  const inputs: InputRow[] = [
    ...detected.map((d) => ({
      id: `v:${d.value}`,
      value: d.value,
      key: overrides[d.value]?.key ?? d.key,
      enabled: overrides[d.value]?.enabled ?? true,
      detected: true,
      steps: d.steps,
    })),
    ...custom.map((c) => ({ ...c, enabled: true, detected: false, steps: [] })),
  ];
  // A hand-added row left blank is not an input yet, nor a mistake.
  const active = inputs.filter((i) => i.enabled && (i.detected || i.key || i.value));
  const inputErrors: Record<string, string> = {};
  const seen = new Set<string>();
  active.forEach((row, i) => {
    try {
      checkInput({ key: row.key, label: inputLabel(row.key) }, i, seen);
    } catch (err) {
      inputErrors[row.id] = err instanceof Error ? err.message : "invalid key";
    }
  });

  // The first question asked in words: a skill run's "/name key=value" line says
  // which procedure ran, not what the investigation was about.
  const firstAsk = (asked.find((q) => !q.skillRun) ?? asked[0])?.text ?? "";
  const autoPurpose = templateValues(
    firstAsk,
    active.filter((i) => !inputErrors[i.id]),
  );
  const purpose = purposeEdited ?? autoPurpose;

  const blockedReason =
    picked.length === 0
      ? "Add at least one step"
      : Object.keys(inputErrors).length
        ? "Fix the input keys marked above"
        : !purpose.trim()
          ? "Say what the skill is for"
          : null;

  // The first pickable call holds the tab stop until the author moves it.
  const tabKey =
    focusKey && addable.some((c) => c.key === focusKey) ? focusKey : (addable[0]?.key ?? null);

  useLeaveGuard(picking && picked.length > 0);

  function reset() {
    pending.current?.abort();
    setPickedKeys(new Set());
    setFocusKey(null);
    setOverrides({});
    setCustom([]);
    setPurposeEdited(null);
    setPhase({ name: "idle" });
    setReviewOpen(false);
  }

  function start() {
    reset();
    setPicking(true);
  }

  /** Leave pick mode; picked steps are only thrown away with consent. */
  function stop() {
    if (pickedKeys.size > 0 && !window.confirm("Discard the picked steps?")) return;
    reset();
    setPicking(false);
  }

  function toggle(key: string) {
    if (phase.name === "generating") return;
    setPickedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else if (next.size < MAX_SKILL_STEPS) next.add(key);
      return next;
    });
  }

  /** Bring a picked call into view in the conversation and mark it briefly. */
  function reveal(key: string) {
    const row = document.querySelector<HTMLElement>(`[data-step-row="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    row.querySelector<HTMLElement>("[data-pick-key]")?.focus({ preventScroll: true });
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlashKey(key);
    flashTimer.current = setTimeout(() => setFlashKey(null), FLASH_MS);
  }

  // Esc closes the builder from anywhere, like the X: `stop` asks before a
  // selection is thrown away, so a stray press costs nothing.
  useShortcut(SHORTCUTS.close.keys, () => stop(), picking);

  /**
   * Keyboard picking over the conversation: ↑/↓ between calls, Space (the
   * button's own) adds, Enter opens the call's output.
   */
  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const target = e.target as HTMLElement;
    if (!target.dataset.pickKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const all = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-pick-key]")];
      const next = all[all.indexOf(target) + (e.key === "ArrowDown" ? 1 : -1)];
      if (!next) return;
      e.preventDefault();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      target
        .closest("[data-step-row]")
        ?.querySelector<HTMLElement>("[data-slot=collapsible-trigger]")
        ?.click();
    }
  }

  function setInputKey(row: InputRow, key: string) {
    if (row.detected) setOverrides((o) => ({ ...o, [row.value]: { ...o[row.value], key } }));
    else setCustom((c) => c.map((r) => (r.id === row.id ? { ...r, key } : r)));
  }

  function setInputValue(row: InputRow, value: string) {
    setCustom((c) => c.map((r) => (r.id === row.id ? { ...r, value } : r)));
  }

  function setInputEnabled(row: InputRow, enabled: boolean) {
    setOverrides((o) => ({ ...o, [row.value]: { ...o[row.value], enabled } }));
  }

  function addInput() {
    if (inputs.length >= SKILL_LIMITS.inputs) return;
    setCustom((c) => [...c, { id: `c:${crypto.randomUUID()}`, value: "", key: "" }]);
  }

  function removeInput(row: InputRow) {
    setCustom((c) => c.filter((r) => r.id !== row.id));
  }

  async function generate() {
    if (blockedReason || !conversationId || phase.name === "generating") return;
    const controller = new AbortController();
    pending.current = controller;
    setPhase({ name: "generating", startedAt: Date.now() });
    try {
      const res = await fetch(`/api/conversations/${conversationId}/skill-draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          steps: picked.map((p) => p.key),
          inputs: active.map((i) => ({
            key: i.key,
            label: inputLabel(i.key),
            required: i.value !== "",
            value: i.value || undefined,
          })),
          purpose,
        }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok)
        throw new Error(
          body?.error ?? `Holmes did not answer (HTTP ${res.status}). Try again.`,
        );
      sessionStorage.setItem(SKILL_SEED_KEY, JSON.stringify(body.draft as SkillDraft));
      router.push("/skills/new?from=conversation");
    } catch (err) {
      if (controller.signal.aborted) {
        setPhase({ name: "idle" });
        return;
      }
      setPhase({
        name: "error",
        message: err instanceof Error ? err.message : "Drafting failed",
      });
    } finally {
      pending.current = null;
    }
  }

  return {
    picking,
    start,
    stop,
    addableCount: addable.length,
    picked,
    stepNumber: (key: string) => numbers.get(key) ?? null,
    toggle,
    tabKey,
    setFocusKey,
    flashKey,
    reveal,
    onKeyDown,
    reviewOpen,
    setReviewOpen,
    inputs,
    inputErrors,
    setInputKey,
    setInputValue,
    setInputEnabled,
    addInput,
    removeInput,
    purpose,
    purposeEdited: purposeEdited !== null,
    setPurpose: setPurposeEdited,
    resetPurpose: () => setPurposeEdited(null),
    blockedReason,
    phase,
    generate,
    cancelGenerate: () => pending.current?.abort(),
  };
}

export type SkillBuilder = ReturnType<typeof useSkillBuilderState>;

/** The builder while picking; null otherwise — every consumer's "am I picking". */
export const SkillBuilderContext = createContext<SkillBuilder | null>(null);

export function useSkillBuilder(): SkillBuilder | null {
  return useContext(SkillBuilderContext);
}
