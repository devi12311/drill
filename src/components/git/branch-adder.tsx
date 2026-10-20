"use client";

import { useEffect, useState } from "react";
import { GitBranchPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAdminMutation } from "@/lib/admin/use-admin-mutation";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Track another branch of a repository — e.g. `rc` when production runs from it
 * (the image-tag prefix convention). Suggestions come from the provider; the API
 * re-checks that the branch exists before saving it.
 */
export function BranchAdder({ repoId }: { repoId: string }) {
  const { mutate, busy, error } = useAdminMutation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<{ name: string; tracked: boolean }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoadError(null);
      try {
        const res = await fetch(`/api/admin/git/repositories/${repoId}/branches?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setOptions(body.branches);
      } catch (err) {
        if (!ctrl.signal.aborted) setLoadError(err instanceof Error ? err.message : "Could not list branches");
      }
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query, repoId]);

  async function add(name: string) {
    const ok = await mutate(`/api/admin/git/repositories/${repoId}`, { method: "PATCH", body: { addBranches: [name] } });
    if (ok) {
      setOpen(false);
      setQuery("");
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)}>
        <GitBranchPlus className="size-3.5" />
        Track a branch
      </Button>
    );
  }

  const untracked = options.filter((o) => !o.tracked).slice(0, 8);
  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3">
      <Input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Branch name, e.g. rc"
        className="font-mono text-[13px]"
        aria-label="Branch to track"
      />
      <div className="flex flex-wrap gap-1.5">
        {untracked.map((o) => (
          <Button key={o.name} variant="secondary" size="sm" disabled={busy} onClick={() => add(o.name)} className="font-mono text-[12px]">
            {o.name}
          </Button>
        ))}
        {!loadError && untracked.length === 0 && (
          <span className="text-body-sm text-bone-gray">{query ? "No untracked branch matches." : "Every branch is tracked."}</span>
        )}
      </div>
      {(loadError || error) && <p className="text-body-sm text-traffic-red">{loadError ?? error}</p>}
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}
