/**
 * The app's keyboard shortcuts — the single source of truth for both the
 * bindings (`useShortcut`) and the help sheet (`?`). Navigation chords are not
 * listed here: they live on the nav items themselves (`WORKSPACE_NAV`,
 * `ADMIN_NAV`), so adding a section and giving it a key is one edit.
 *
 * Combo grammar: `+`-joined modifiers and a key (`mod+shift+o`, `alt+arrowup`),
 * or two space-separated keys for a chord (`g r`). `mod` is ⌘ on macOS and Ctrl
 * elsewhere. Picked to stay clear of keys a browser keeps for itself (Ctrl+N/T/W,
 * Ctrl+1–9) or that users expect to keep (Ctrl+L/D/F/P), and of Ctrl+Shift+C
 * (the element inspector) and Shift+Esc (Chrome's task manager on Windows).
 */
export interface ShortcutDef {
  keys: string;
  label: string;
}

export const SHORTCUTS = {
  modeSwitch: { keys: "mod+k", label: "Switch between chat and admin" },
  help: { keys: "?", label: "Show keyboard shortcuts" },
  helpAlt: { keys: "mod+/", label: "Show keyboard shortcuts" },
  newInvestigation: { keys: "mod+shift+o", label: "New investigation" },
  focusInput: { keys: "/", label: "Focus the composer (or a list's filter)" },
  close: { keys: "escape", label: "Close the dialog, menu or panel" },
  stop: { keys: "escape", label: "Stop the running investigation" },
  prevConversation: { keys: "alt+arrowup", label: "Previous conversation" },
  nextConversation: { keys: "alt+arrowdown", label: "Next conversation" },
  /** Shown as one row; bound as `DIGIT_KEYS`. */
  pickFollowUp: { keys: "1-9", label: "Pick a suggested follow-up, then Enter to ask" },
} satisfies Record<string, ShortcutDef>;

/** 1–9, for picking a follow-up by its position. */
export const DIGIT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Keys a focused component handles itself (a field's Enter, a dialog's Esc),
 * listed in the help sheet for discovery only — the single-key switch leaves
 * them alone.
 */
export const LOCAL_SHORTCUTS = {
  send: { keys: "enter", label: "Send" },
  newline: { keys: "shift+enter", label: "New line" },
  walkCalls: { keys: "arrows", label: "Previous / next tool call (in a call's output)" },
  save: { keys: "mod+s", label: "Save the skill (in the skill editor)" },
} satisfies Record<string, ShortcutDef>;

/** A place a `g` chord jumps to; nav items carry the key so the menu and the chord agree. */
export interface NavJump {
  href: string;
  label: string;
  /** The chord's second key; items without one have no chord. */
  shortcut?: string;
}

/** How long the second key of a chord (`g` then `r`) may wait. */
export const CHORD_MS = 1200;

/** Navigation chords all start with `g`, as on GitHub, Linear and Gmail. */
export function navChord(key: string): string {
  return `g ${key}`;
}

interface Combo {
  mod: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
}

function parseCombo(part: string): Combo {
  const tokens = part.split("+");
  const key = tokens.pop()!;
  return {
    mod: tokens.includes("mod"),
    shift: tokens.includes("shift"),
    alt: tokens.includes("alt"),
    key,
  };
}

/** A chord's steps, e.g. `g r` → [g, r]. */
export function comboSteps(keys: string): string[] {
  return keys.split(" ");
}

/**
 * "Character key" shortcuts in WCAG 2.1.4 terms — no Ctrl/⌘/Alt — which must be
 * switchable off and never fire while the user is typing.
 */
export function isCharacterShortcut(keys: string): boolean {
  return comboSteps(keys).every((step) => {
    const c = parseCombo(step);
    return !c.mod && !c.alt && c.key !== "escape";
  });
}

function isLetter(key: string) {
  return /^[a-z]$/.test(key);
}

/**
 * Does `e` press `step`? Letters also match by physical key (`KeyK`), so Ctrl+K
 * works on a Cyrillic or Greek layout too. Symbols like `?` and `/` match the
 * produced character and ignore Shift, which layouts need differently.
 */
export function matchesStep(e: KeyboardEvent, step: string): boolean {
  const c = parseCombo(step);
  if (c.mod !== (e.ctrlKey || e.metaKey) || c.alt !== e.altKey) return false;
  const key = e.key.toLowerCase();
  if (isLetter(c.key) || c.key.length > 1) {
    if (c.shift !== e.shiftKey) return false;
    return key === c.key || (isLetter(c.key) && e.code === `Key${c.key.toUpperCase()}`);
  }
  return key === c.key;
}

/** Display tokens for one step, e.g. `mod+shift+o` → ["Ctrl", "Shift", "O"]. */
export function stepLabels(step: string, mac: boolean): string[] {
  const c = parseCombo(step);
  const out: string[] = [];
  if (c.mod) out.push(mac ? "⌘" : "Ctrl");
  if (c.alt) out.push(mac ? "⌥" : "Alt");
  if (c.shift) out.push(mac ? "⇧" : "Shift");
  out.push(KEY_NAMES[c.key] ?? c.key.toUpperCase());
  return out;
}

const KEY_NAMES: Record<string, string> = {
  escape: "Esc",
  enter: "Enter",
  arrowup: "↑",
  arrowdown: "↓",
  "1-9": "1–9",
  arrows: "↑ ↓",
};

/** A combo as plain text, for `title` attributes: "Ctrl+K", "G then R". */
export function comboText(keys: string, mac: boolean): string {
  return comboSteps(keys)
    .map((step) => stepLabels(step, mac).join(mac ? "" : "+"))
    .join(" then ");
}
