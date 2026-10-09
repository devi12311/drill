"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { confirmLeave } from "@/components/ui/use-leave-guard";
import {
  CHORD_MS,
  SHORTCUTS,
  comboSteps,
  isCharacterShortcut,
  matchesStep,
  navChord,
  type NavJump,
} from "@/lib/shortcuts";

/** Return false to pass the key on (to an older binding, or the browser). */
type Handler = (e: KeyboardEvent, keys: string) => boolean | void;

interface Binding {
  keys: string;
  handler: RefObject<Handler>;
}

const ShortcutsContext = createContext<((binding: Binding) => () => void) | null>(null);

/**
 * Bind a shortcut (or several — `keys` as an array) for as long as the caller
 * is mounted and `enabled`. The newest binding of a combo wins, so a page can
 * claim a key the shell also uses. Never fires while a dialog or menu is open:
 * those own the keyboard, and Esc there is theirs.
 */
export function useShortcut(keys: string | string[], handler: Handler, enabled = true) {
  const register = useContext(ShortcutsContext);
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  const joined = Array.isArray(keys) ? keys.join("|") : keys;
  useEffect(() => {
    if (!register || !enabled) return;
    const off = joined.split("|").map((k) => register({ keys: k, handler: ref }));
    return () => off.forEach((f) => f());
  }, [register, joined, enabled]);
}

const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);

/** Is the key going into a text field? Character shortcuts stay out of the way then. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type);
}

/** A Radix dialog, alert or menu is open — it owns the keyboard (and its Esc). */
function overlayOpen(): boolean {
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}

/* ----- the character-key switch (WCAG 2.1.4) ----- */

const CHAR_KEYS_STORAGE = "drill.shortcuts.characterKeys";
const CHAR_KEYS_EVENT = "drill:shortcuts-pref";

function readCharacterKeys(): boolean {
  try {
    return localStorage.getItem(CHAR_KEYS_STORAGE) !== "off";
  } catch {
    return true;
  }
}

function subscribeCharacterKeys(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHAR_KEYS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHAR_KEYS_EVENT, onChange);
  };
}

/**
 * Single-key shortcuts (`?`, `/`, `g r`, 1–9) can be turned off — speech input
 * and stray presses trigger them. Modifier shortcuts (Ctrl+K…) stay on.
 */
export function useCharacterKeys(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribeCharacterKeys, readCharacterKeys, () => true);
  const set = (next: boolean) => {
    try {
      if (next) localStorage.removeItem(CHAR_KEYS_STORAGE);
      else localStorage.setItem(CHAR_KEYS_STORAGE, "off");
    } catch {
      // A preference that does not persist still applies to this page view.
    }
    window.dispatchEvent(new Event(CHAR_KEYS_EVENT));
  };
  return [on, set];
}

const noSubscribe = () => () => {};

/** ⌘ or Ctrl. Server-renders as not-Mac; the client corrects it after hydration. */
export function useIsMac(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
    () => false,
  );
}

/* ----- the dispatcher ----- */

/**
 * One window listener for every shortcut in the app, mounted by the `(app)`
 * shell. Components bind through `useShortcut`; the help sheet reads the same
 * `SHORTCUTS` table, so the two cannot drift.
 */
export function ShortcutsProvider({ children }: { children: React.ReactNode }) {
  const bindings = useRef<Binding[]>([]);
  const [register] = useState(() => (binding: Binding) => {
    bindings.current.push(binding);
    return () => {
      bindings.current = bindings.current.filter((b) => b !== binding);
    };
  });

  useEffect(() => {
    // The first key of a chord, while it waits for the second.
    let chord: { step: string; at: number } | null = null;

    function onKeyDown(e: KeyboardEvent) {
      // Already handled by the focused component (the composer's own Esc, a menu).
      if (e.defaultPrevented || e.repeat || e.isComposing) return;
      if (overlayOpen()) {
        chord = null;
        return;
      }
      const characterKeys = !isTypingTarget(e.target) && readCharacterKeys();
      const pending = chord && Date.now() - chord.at < CHORD_MS ? chord.step : null;
      chord = null;

      const newestFirst = [...bindings.current].reverse();
      for (const b of newestFirst) {
        if (isCharacterShortcut(b.keys) && !characterKeys) continue;
        const steps = comboSteps(b.keys);
        const hit =
          steps.length === 1
            ? matchesStep(e, steps[0])
            : pending === steps[0] && matchesStep(e, steps[1]);
        if (hit && b.handler.current(e, b.keys) !== false) {
          e.preventDefault();
          return;
        }
      }
      if (!characterKeys) return;
      const starts = newestFirst.find((b) => {
        const steps = comboSteps(b.keys);
        return steps.length === 2 && matchesStep(e, steps[0]);
      });
      if (starts) chord = { step: comboSteps(starts.keys)[0], at: Date.now() };
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <ShortcutsContext.Provider value={register}>
      <FocusInputShortcut />
      {children}
    </ShortcutsContext.Provider>
  );
}

/**
 * `/` focuses the page's main input — the composer on chat, the filter on a
 * list page. Pages opt in by marking the field `data-shortcut-focus`, so the
 * key needs no per-page wiring.
 */
function FocusInputShortcut() {
  useShortcut(SHORTCUTS.focusInput.keys, () => {
    const field = document.querySelector<HTMLElement>("[data-shortcut-focus]");
    if (!field) return false;
    field.focus();
  });
  return null;
}

/**
 * Navigate unless unsaved work says no. Keyboard navigation is not a link
 * click, so the leave guard's click listener would never see it.
 */
export function useGuardedPush() {
  const router = useRouter();
  return (href: string) => {
    if (confirmLeave()) router.push(href);
  };
}

/** `g` + a jump's key goes to it — both sidebars bind their own section list. */
export function useNavShortcuts(jumps: NavJump[]) {
  const pathname = usePathname();
  const push = useGuardedPush();
  const keyed = jumps.filter((j) => j.shortcut);
  useShortcut(
    keyed.map((j) => navChord(j.shortcut!)),
    (_e, keys) => {
      const jump = keyed.find((j) => navChord(j.shortcut!) === keys);
      if (jump && jump.href !== pathname) push(jump.href);
    },
  );
}
