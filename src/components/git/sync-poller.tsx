"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const INTERVAL_MS = 3_000;

/**
 * Re-renders the server page while something on it is queued or indexing, and
 * stops by itself once the page renders with nothing in flight (the server passes
 * `active={false}`). Sync is asynchronous — the worker and the gateway do it — so
 * this is how the page notices it finished without the admin reloading.
 */
export function SyncPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), INTERVAL_MS);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
