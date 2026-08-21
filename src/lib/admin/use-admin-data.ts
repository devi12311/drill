"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Client fetch for admin endpoints, re-run whenever `url` or `deps` change.
 * Mirrors the app's existing client-fetch pattern (/resolutions) with
 * AbortController cancellation.
 *
 * `refetch()` re-runs the same request — pages that mutate (create/delete a
 * cluster, mute a concern) call it instead of reloading the whole document.
 *
 * STALE-WHILE-REVALIDATE, and that is the whole point of the hook.
 *
 * It previously raised `loading` on every re-run while every caller guarded with
 * `if (loading || !data) return <p>Loading…</p>`. So any mutation — enabling a
 * check, retagging one workload, muting one concern — unmounted the entire page
 * and replaced it with a single line of text: the document collapsed, the
 * browser clamped the scroll offset, and every open modal, collapsible and bit
 * of local state in the subtree was destroyed. The data was still in memory the
 * whole time; the flash was gratuitous.
 *
 * So `loading` now means "there is nothing to show for this url yet" and
 * `refreshing` means "what you are looking at is being revalidated". Callers
 * gate their skeleton on `loading` and, at most, dim on `refreshing`.
 */
export function useAdminData<T>(url: string, deps: unknown[] = []) {
  /** The response, tagged with the url it came from — see `loadedUrl` below. */
  const [entry, setEntry] = useState<{ url: string; body: T } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /**
   * Which url the data in state actually came from. Revalidating the SAME url
   * keeps the old response on screen; moving to a DIFFERENT one must not — one
   * cluster's inventory rendered under another cluster's heading is worse than a
   * skeleton. `url` is also in the dep array now: it was previously missing
   * behind a suppressed lint rule, so a caller that changed the url without
   * changing `deps` kept serving the old response.
   */
  const loadedUrl = useRef<string | null>(null);

  const refetch = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    /**
     * An empty url means "nothing to load yet" — the catalogue panels pass one
     * while no definition is open. Without this, `fetch("")` resolves against the
     * current document, so every visit to those pages made a pointless request for
     * its own HTML and then set an error parsing it as JSON.
     */
    if (!url) return;
    const controller = new AbortController();
    const isRevalidation = loadedUrl.current === url;
    if (isRevalidation) setRefreshing(true);
    else setLoading(true);

    (async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        loadedUrl.current = url;
        setEntry({ url, body });
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Request failed");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps, reloadKey]);

  return {
    // Never hand back another url's response. Compared against state rather than
    // the ref, which must not be read during render.
    data: entry?.url === url ? entry.body : null,
    // Nothing is pending when there is nothing to fetch.
    loading: url ? loading : false,
    refreshing,
    error,
    refetch,
  };
}
