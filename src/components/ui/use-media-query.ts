"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a media query matches, tracked live. False on the server: use it for
 * layout that only exists after an interaction, never for the first paint.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
