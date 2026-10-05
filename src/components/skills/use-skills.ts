"use client";

import { useEffect, useState } from "react";
import type { SkillView } from "@/lib/skills/types";

/**
 * GET /api/skills for the library page and the composer's picker. Null while
 * loading; an error leaves the list empty rather than blocking the page.
 */
export function useSkills(): { skills: SkillView[] | null; error: string | null } {
  const [state, setState] = useState<{ skills: SkillView[] | null; error: string | null }>({
    skills: null,
    error: null,
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/skills", { signal: controller.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
        setState({ skills: body as SkillView[], error: null });
      })
      .catch((err) => {
        if (!controller.signal.aborted)
          setState({ skills: [], error: err instanceof Error ? err.message : "Failed to load skills" });
      });
    return () => controller.abort();
  }, []);
  return state;
}
