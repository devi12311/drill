"use client";

import { useEffect } from "react";

const MESSAGE = "You have unsaved changes. Leave and discard them?";

/** Mounted guards holding unsaved work — read by navigations that are not links. */
let dirtyGuards = 0;

/**
 * For a navigation that is not a link click (a keyboard shortcut, a
 * `router.push` button): true when nothing unsaved is open, or the user agrees
 * to discard it. The click listener below cannot see these.
 */
export function confirmLeave(): boolean {
  return dirtyGuards === 0 || window.confirm(MESSAGE);
}

/**
 * Asks before unsaved work is thrown away. The App Router has no navigation
 * blocker, so in-app links are caught in the capture phase, before Next's own
 * <Link> handler runs; closing or reloading the tab goes through beforeunload.
 * The browser back button is not covered — there is no reliable hook for it.
 */
export function useLeaveGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    dirtyGuards += 1;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // new tab
      const link = (e.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      if (!window.confirm(MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      dirtyGuards -= 1;
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);
}
