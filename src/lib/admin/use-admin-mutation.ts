"use client";

import { useCallback, useState } from "react";
import { useRefreshThenNavigate } from "./use-refresh-then-navigate";

/**
 * The life of an admin action button: call the API, surface its error, then
 * re-render the server page (and any module tree) through refresh-then-navigate.
 * Returns the parsed body on success, or null when the call failed. A failing
 * API's `field` is kept beside the message, so a form can show it on that input.
 *
 * `then` is where to go afterwards: `null` refreshes in place, a string navigates,
 * a function decides from the response (e.g. to the row just created).
 * `{ leave: href }` is for a delete of the page you are on: refreshing it first
 * would render its 404 and unmount this hook before it could navigate (and a
 * server `redirect()` is not followed by `router.refresh()`), so it does a full
 * navigation instead — which also renders every module tree fresh.
 */
export function useAdminMutation() {
  const refresh = useRefreshThenNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<string | null>(null);

  const mutate = useCallback(
    async <T = Record<string, unknown>>(
      url: string,
      init: { method: string; body?: unknown },
      then: string | null | { leave: string } | ((body: T) => string | null) = null,
    ): Promise<T | null> => {
      setBusy(true);
      setError(null);
      setErrorField(null);
      let leaving = false;
      try {
        const res = await fetch(url, {
          method: init.method,
          headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
        });
        const body = (await res.json().catch(() => ({}))) as T & { error?: string; field?: string };
        if (!res.ok) {
          setErrorField(body.field ?? null);
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        if (then && typeof then === "object") {
          leaving = true; // stays busy: the page is going away
          window.location.assign(then.leave);
          return body;
        }
        refresh(typeof then === "function" ? then(body) : then);
        return body;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Request failed");
        return null;
      } finally {
        if (!leaving) setBusy(false);
      }
    },
    [refresh],
  );

  return { mutate, busy, error, errorField };
}
