"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Refresh the server-rendered chrome, THEN navigate — in that order, reliably.
 *
 * The monitoring module's sidebar tree is rendered by the shared layout
 * (`app/(app)/admin/monitoring/layout.tsx`), and a client-side navigation reuses
 * a shared layout segment from the router cache instead of re-rendering it. So
 * the only thing that can update the tree after a mutation is
 * `router.refresh()`, which refetches the current route including its layouts.
 *
 * Every mutation site used to call `router.refresh()` and `router.push()` in the
 * same tick. `refresh()` does not return a promise, so the push started while
 * the refresh was still in flight — and the navigation re-read, and re-cached,
 * the very layout payload the refresh was about to replace. That is why a
 * just-created job was missing from the tree on the page you landed on: the
 * refresh was not lost to a race in some abstract sense, it was overwritten.
 *
 * A transition makes the ordering explicit: `isPending` tracks the refresh, and
 * the navigation is issued once it has committed. Pass `null` to refresh in
 * place (a rename, a run finishing) with no navigation.
 *
 * Note there is deliberately no `revalidatePath` counterpart on the server: every
 * route in this module is dynamic (`ƒ`), so there is no Full Route Cache entry to
 * purge — the staleness is entirely client-side, and this is where it lives.
 */
export function useRefreshThenNavigate() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Where to go when the refresh commits; `null` means "refresh only". */
  const target = useRef<string | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    if (!armed.current || pending) return;
    armed.current = false;
    const href = target.current;
    target.current = null;
    if (href) router.push(href);
  }, [pending, router]);

  return useCallback(
    (href: string | null) => {
      target.current = href;
      armed.current = true;
      startTransition(() => router.refresh());
    },
    [router, startTransition],
  );
}
