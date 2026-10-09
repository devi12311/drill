"use client";

import { useSyncExternalStore } from "react";
import { useSession } from "@/components/session/session-provider";
import { isAnswerMode, type AnswerMode } from "@/lib/chat/answer-style";

const STORAGE_PREFIX = "drill.answerMode.";
const CHANGE_EVENT = "drill:answer-mode";
/** Where a pick lives for this page view when storage is blocked. */
const unstored = new Map<string, AnswerMode>();

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The answer mode the next ask is sent with: this viewer's last pick in this
 * org, else the org's default. Only an explicit pick is stored, so a viewer who
 * never touched it follows the org when an admin changes the default.
 */
export function useAnswerMode(): [AnswerMode, (mode: AnswerMode) => void] {
  const { org } = useSession().user;
  const key = STORAGE_PREFIX + org.id;
  const read = () => {
    try {
      const stored = localStorage.getItem(key);
      return isAnswerMode(stored) ? stored : org.answerMode;
    } catch {
      return unstored.get(key) ?? org.answerMode;
    }
  };
  const mode = useSyncExternalStore(subscribe, read, () => org.answerMode);
  const set = (next: AnswerMode) => {
    try {
      localStorage.setItem(key, next);
    } catch {
      // Blocked storage: the pick still applies until the page is left.
      unstored.set(key, next);
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  };
  return [mode, set];
}
