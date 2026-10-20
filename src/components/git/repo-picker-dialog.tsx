"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { formatRelative } from "@/lib/admin/format";
import { useAdminMutation } from "@/lib/admin/use-admin-mutation";
import type { RemoteRepo } from "@/lib/git/types";

type PickerRepo = RemoteRepo & { added: boolean };

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Pick repositories to sync from one connection. The list is searched on the
 * provider (server-side, paginated) rather than downloaded whole: a workspace can
 * hold hundreds of repositories and the admin is looking for a few.
 */
export function AddRepositoriesButton({ connectionId, defaultOpen = false }: { connectionId: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  // `?add=1` arriving while already on this page (the tree's "Add repositories")
  // must open it too, not just the first render.
  const [openedFor, setOpenedFor] = useState(defaultOpen);
  if (defaultOpen !== openedFor) {
    setOpenedFor(defaultOpen);
    if (defaultOpen) setOpen(true);
  }
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        Add repositories
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[560px] gap-4">
          <DialogHeader>
            <DialogTitle>Add repositories</DialogTitle>
            <DialogDescription>
              Each one is cloned and indexed on its default branch; you can track more branches afterwards. A first index
              takes from seconds to a few minutes.
            </DialogDescription>
          </DialogHeader>
          {open && <Picker connectionId={connectionId} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Picker({ connectionId, onDone }: { connectionId: string; onDone: () => void }) {
  const { mutate, busy, error } = useAdminMutation();
  const [query, setQuery] = useState("");
  const [repos, setRepos] = useState<PickerRepo[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<{ fullName: string; reason: string }[]>([]);
  // The request in flight (first page or "Load more"): a new query aborts it, so a
  // late page of the old query can never append to the new list.
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(
    async (q: string, p: number, signal: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch(
          `/api/admin/git/connections/${connectionId}/available?q=${encodeURIComponent(q)}&page=${p}`,
          { signal },
        );
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setRepos((prev) => (p === 1 ? body.repos : [...prev, ...body.repos]));
        setHasMore(body.hasMore);
      } catch (err) {
        if (!signal.aborted) setLoadError(err instanceof Error ? err.message : "Could not list repositories");
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [connectionId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    inFlight.current?.abort();
    inFlight.current = ctrl;
    const t = setTimeout(() => {
      setPage(1);
      void load(query, 1, ctrl.signal);
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, load]);

  function toggle(fullName: string, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(fullName);
      else next.delete(fullName);
      return next;
    });
  }

  async function submit() {
    const result = await mutate<{ added: unknown[]; skipped: { fullName: string; reason: string }[] }>(
      "/api/admin/git/repositories",
      { method: "POST", body: { connectionId, fullNames: [...picked] } },
    );
    if (!result) return;
    if (result.skipped.length) {
      // Keep the dialog open to say what did not make it, and why.
      setSkipped(result.skipped);
      setPicked(new Set());
    } else {
      onDone();
    }
  }

  return (
    <>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-bone-gray" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name"
          className="pl-8"
          aria-label="Search repositories"
        />
      </div>

      <DialogBody className="max-h-[50vh] space-y-1">
        {repos.map((r) => (
          <label
            key={r.externalId}
            className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-smoke-charcoal has-[:disabled]:cursor-default has-[:disabled]:opacity-60"
          >
            <Checkbox
              checked={r.added || picked.has(r.fullName)}
              disabled={r.added}
              onCheckedChange={(v) => toggle(r.fullName, v === true)}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body-sm text-warm-off-white">{r.fullName}</span>
              <span className="block text-[12px] text-bone-gray">
                <span className="font-mono">{r.defaultBranch}</span>
                {r.private ? " · private" : " · public"}
                {r.updatedAt && ` · updated ${formatRelative(r.updatedAt)}`}
              </span>
            </span>
            {r.added && <span className="text-[12px] text-bone-gray">synced</span>}
          </label>
        ))}
        {loading && <p className="px-2 py-2 text-body-sm text-bone-gray">Loading…</p>}
        {!loading && !loadError && repos.length === 0 && (
          <p className="px-2 py-2 text-body-sm text-bone-gray">
            {query ? "No repository matches." : "This token sees no repositories."}
          </p>
        )}
        {loadError && <p className="px-2 py-2 text-body-sm text-traffic-red">{loadError}</p>}
        {hasMore && !loading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const next = page + 1;
              setPage(next);
              const ctrl = new AbortController();
              inFlight.current = ctrl;
              void load(query, next, ctrl.signal);
            }}
          >
            Load more
          </Button>
        )}
      </DialogBody>

      {skipped.length > 0 && (
        <div className="space-y-1 text-body-sm">
          <p className="text-traffic-yellow">Not added:</p>
          {skipped.map((s) => (
            <p key={s.fullName} className="text-bone-gray">
              <span className="font-mono text-[12px]">{s.fullName}</span> — {s.reason}
            </p>
          ))}
        </div>
      )}
      {error && <p className="text-body-sm text-traffic-red">{error}</p>}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          {skipped.length ? "Close" : "Cancel"}
        </Button>
        <Button onClick={submit} disabled={busy || picked.size === 0}>
          {busy
            ? "Adding…"
            : picked.size
              ? `Add ${picked.size} ${picked.size === 1 ? "repository" : "repositories"}`
              : "Add repositories"}
        </Button>
      </DialogFooter>
    </>
  );
}
