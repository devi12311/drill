import { flushSync } from "react-dom";

let settled: Promise<void> = Promise.resolve();

/**
 * Resolves when the view transition running now (if any) has finished. Size
 * morphs animate on the main thread, so a long React commit mid-transition
 * freezes them and they jump; work that can wait a few hundred ms should.
 */
export function viewTransitionSettled(): Promise<void> {
  return settled;
}

/**
 * Run a React state change as a same-document view transition: the browser
 * snapshots the page, the change is flushed synchronously inside the callback,
 * and named elements (`view-transition-name`) animate from their old box to
 * their new one. The update runs exactly once either way — directly where the
 * API is missing or the user prefers reduced motion — and its result is passed
 * through. It runs a frame later than a direct call, after the old snapshot.
 */
export function withViewTransition<T>(update: () => T | Promise<T>): Promise<T> {
  const reduced =
    typeof matchMedia !== "undefined" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (typeof document === "undefined" || !document.startViewTransition || reduced) {
    return Promise.resolve().then(update);
  }
  // Stylesheets scope their `view-transition-name`s to this attribute, so the
  // names (and the stacking contexts they create) exist only mid-transition.
  const root = document.documentElement;
  root.dataset.viewTransition = "";
  return new Promise((resolve, reject) => {
    const transition = document.startViewTransition(() => {
      try {
        let result!: T | Promise<T>;
        flushSync(() => {
          result = update();
        });
        Promise.resolve(result).then(resolve, reject);
      } catch (err) {
        // A throwing update skips the animation; the caller still hears of it.
        reject(err);
      }
    });
    const cleanup = () => {
      delete root.dataset.viewTransition;
    };
    settled = transition.finished.then(cleanup, cleanup);
  });
}
