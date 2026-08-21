"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DialogBody } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckForm } from "@/components/monitoring/check-form";
import {
  DefinitionGrid,
  DefinitionSection,
  DefinitionTile,
} from "@/components/monitoring/definition-grid";
import {
  DefinitionBlock,
  DefinitionModal,
  ModalFooter,
  useDefinitionParam,
} from "@/components/monitoring/definition-modal";
import { SeverityBadge } from "@/components/monitoring/severity-badge";

import { useAdminData } from "@/lib/admin/use-admin-data";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import {
  CATEGORY_LABEL,
  REQUIREMENT_LABEL,
  SEVERITY_CLASS,
  describeScope,
} from "@/lib/monitoring/ui";
import { MONITOR_CATEGORIES } from "@/lib/monitoring/types";
import type {
  CheckListItem,
  CheckRequirement,
  CheckView,
  MonitorCategory,
} from "@/lib/monitoring/types";

/**
 * The interactive half of the check catalogue: filter, tiles, and the panel.
 *
 * The grid arrives as a prop from the server page, in the lean
 * {@link CheckListItem} shape; the panel loads the one definition it opens. The
 * page used to fetch the whole rubric — ~125 KB, `question` and `evidence`
 * included — from the browser on mount, spend a round-trip showing the word
 * "Loading…", and then download all of it again after every save. A mutation now
 * calls `refresh()`, which re-runs the server page and hands this component new
 * props.
 */
export function ChecksBrowser({ checks }: { checks: CheckListItem[] }) {
  const refresh = useRefreshThenNavigate();
  const [openId, setOpenId] = useDefinitionParam("check");
  const [query, setQuery] = useState("");
  // Typing must not block on re-rendering ~180 tiles.
  const deferredQuery = useDeferredValue(query);

  const creating = openId === "new";
  const open = creating ? null : (checks.find((c) => c.id === openId) ?? null);

  /**
   * Grouped and filtered in ONE pass, memoised.
   *
   * This used to be three `filter` walks of the whole catalogue per category,
   * executed inside the render loop — so every keystroke in the box above cost
   * six full passes over ~180 checks plus a re-render of every tile.
   */
  const sections = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    const byCategory = new Map<
      MonitorCategory,
      { shown: CheckListItem[]; total: number; active: number }
    >(
      MONITOR_CATEGORIES.map((c) => [c, { shown: [], total: 0, active: 0 }]),
    );
    for (const check of checks) {
      const bucket = byCategory.get(check.category);
      if (!bucket) continue;
      bucket.total += 1;
      if (check.enabled) bucket.active += 1;
      if (
        !needle ||
        // ID and title only: the question is no longer shipped to the grid, and
        // a server-side search is a different feature from a client filter.
        `${check.id} ${check.title}`.toLowerCase().includes(needle)
      )
        bucket.shown.push(check);
    }
    return MONITOR_CATEGORIES.map((category) => ({
      category,
      ...byCategory.get(category)!,
    })).filter((s) => s.shown.length > 0);
  }, [checks, deferredQuery]);

  const filtering = deferredQuery.trim().length > 0;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Check catalogue"
        description="The rubric every assessment answers. Holmes supplies evidence and prose; these checks supply the questions and the severities, which is what makes findings comparable from one run to the next."
      >
        <Button onClick={() => setOpenId("new")}>
          <Plus className="size-3.5" />
          New check
        </Button>
      </AdminPageHeader>

      <div className="relative max-w-[42ch]">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-bone-gray" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by ID or title"
          className="pl-8"
          aria-label="Filter checks"
          autoComplete="off"
        />
      </div>

      {sections.length === 0 ? (
        <p className="py-8 text-body-sm text-bone-gray">
          No check matches that filter.
        </p>
      ) : (
        sections.map(({ category, shown, total, active }) => (
          <DefinitionSection
            key={category}
            title={CATEGORY_LABEL[category]}
            note={
              filtering
                ? `${shown.length} of ${total} shown`
                : `${active} of ${total} active`
            }
          >
            <DefinitionGrid>
              {shown.map((check) => (
                <DefinitionTile
                  key={check.id}
                  id={check.id}
                  title={check.title}
                  caption={check.id}
                  railClass={SEVERITY_CLASS[check.baseSeverity]}
                  marker={
                    !check.enabled
                      ? "disabled"
                      : check.version > 1
                        ? `v${check.version}`
                        : undefined
                  }
                  dimmed={!check.enabled}
                  onOpen={setOpenId}
                />
              ))}
            </DefinitionGrid>
          </DefinitionSection>
        ))
      )}

      {/* Keyed by the open definition, so a panel ALWAYS mounts in read mode with
          no messages carried over from the last one. That reset used to be a
          setState during render, which cost an extra render pass per panel
          change and read as a bug even though it worked. */}
      <CheckPanel
        key={openId ?? "closed"}
        summary={open}
        creating={creating}
        onOpenId={setOpenId}
        onMutated={() => refresh(null)}
      />
    </div>
  );
}

/**
 * One definition's panel. Its own component so its transient state — editing,
 * dirty, the "N concerns were closed" notice — is scoped to the definition it
 * belongs to and cannot outlive it.
 *
 * It receives the grid's lean row and loads the rest itself. The panel opens
 * immediately with the title, ID and severity it already has, and the two long
 * prose fields fill in a moment later — which is a far better trade than making
 * every visitor download all 180 definitions in case they open one. Opening the
 * panel is a `pushState`, not a navigation, so the server cannot supply this;
 * `GET /api/admin/monitoring/checks/[id]` already existed for it and had no
 * caller.
 */
function CheckPanel({
  summary,
  creating,
  onOpenId,
  onMutated,
}: {
  summary: CheckListItem | null;
  creating: boolean;
  onOpenId: (id: string | null) => void;
  onMutated: () => void;
}) {
  const detail = useAdminData<{ check: CheckView; concernCount: number }>(
    summary ? `/api/admin/monitoring/checks/${summary.id}` : "",
    [summary?.id],
  );
  const check = summary && detail.data ? detail.data.check : null;
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Every way out of the panel — Escape, the overlay, the X, Cancel — comes
   * through here, because an editor that discards silently is one stray click
   * away from losing a rewritten check.
   */
  function mayDiscard() {
    return !dirty || confirm("Discard your unsaved changes to this check?");
  }

  function close() {
    onOpenId(null);
  }

  function leaveEditor() {
    if (!mayDiscard()) return;
    setDirty(false);
    if (creating) close();
    else setEditing(false);
  }

  async function toggle(target: CheckListItem) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/monitoring/checks/${target.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !target.enabled }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.autoResolved > 0)
        setNotice(
          `${target.id} disabled — ${body.autoResolved} open concern(s) were closed, because a check that no longer runs can never be re-checked.`,
        );
      onMutated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: CheckListItem) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/checks/${target.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      close();
      onMutated();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DefinitionModal
      open={creating || summary !== null}
      onClose={close}
      title={creating ? "New check" : (summary?.title ?? "")}
      identifier={creating ? undefined : summary?.id}
      confirmClose={mayDiscard}
      badges={
        summary && (
          <>
            <SeverityBadge severity={summary.baseSeverity} />
            <Badge variant="outline" className="text-bone-gray">
              {summary.builtin ? "built-in" : "custom"}
            </Badge>
            {summary.version > 1 && (
              <span className="text-caption-tracked text-bone-gray">
                v{summary.version}
              </span>
            )}
            {!summary.enabled && (
              <span className="text-caption-tracked uppercase text-bone-gray">
                disabled
              </span>
            )}
          </>
        )
      }
    >
      {creating || editing ? (
        <CheckForm
          check={check ?? undefined}
          onCancel={leaveEditor}
          onDirtyChange={setDirty}
          onSaved={(saved) => {
            setDirty(false);
            /**
             * Saving closes the panel.
             *
             * It used to stay open and swap back to the read view — which
             * remounted the body and threw away your scroll position, so editing
             * measurement 17 and saving dropped you at the top of a panel you had
             * no further business in. A new check keeps its panel open on its own
             * ID, because "look at the thing you just authored" is a real next
             * step; an edit is finished.
             */
            if (creating) onOpenId(saved.id);
            else close();
            onMutated();
          }}
        />
      ) : detail.error ? (
        <DialogBody>
          <p className="text-body-sm text-traffic-red">{detail.error}</p>
        </DialogBody>
      ) : !check ? (
        <DialogBody className="space-y-4">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-12" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12" />
        </DialogBody>
      ) : (
        summary && (
          <>
            <DialogBody className="space-y-4">
              {notice && (
                <p className="text-body-sm text-traffic-yellow">{notice}</p>
              )}
              {actionError && (
                <p className="text-body-sm text-traffic-red">{actionError}</p>
              )}

              <DefinitionBlock label="What Holmes must determine">
                <p className="max-w-[90ch] text-body-sm text-pale-stone">
                  {check.question}
                </p>
              </DefinitionBlock>

              <DefinitionBlock label="Evidence it must cite">
                <p className="max-w-[90ch] text-body-sm text-bone-gray">
                  {check.evidence}
                </p>
              </DefinitionBlock>

              <DefinitionBlock label="Scope">
                <p className="text-body-sm text-bone-gray">
                  {describeScope(check)}
                </p>
                {check.requires && (
                  <p className="text-body-sm text-bone-gray">
                    Needs{" "}
                    {REQUIREMENT_LABEL[check.requires as CheckRequirement] ??
                      check.requires}
                    . Where it is unavailable the check is skipped, never passed.
                  </p>
                )}
                {check.resolveAfterAbsentRuns > 1 && (
                  <p className="text-body-sm text-bone-gray">
                    Auto-resolves after {check.resolveAfterAbsentRuns} clean
                    runs.
                  </p>
                )}
              </DefinitionBlock>

              {check.reference && (
                <DefinitionBlock label="Cites">
                  <p className="text-body-sm text-bone-gray">
                    {check.reference}
                  </p>
                </DefinitionBlock>
              )}
            </DialogBody>

            <ModalFooter>
              <Button disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => toggle(summary)}
              >
                {summary.enabled ? "Disable" : "Enable"}
              </Button>
              {!summary.builtin && (
                <ConfirmButton
                  label="Delete"
                  title={`Delete ${summary.id}?`}
                  description="Disabling is usually safer: a disabled check stops running and auto-resolves its open concerns, but stays readable next to the history it produced. Deleting removes the definition while the concerns citing it remain, referring to a check that no longer exists."
                  confirmLabel="Delete check"
                  destructive
                  disabled={busy}
                  onConfirm={() => remove(summary)}
                />
              )}
              <Button
                variant="ghost"
                className="ml-auto"
                disabled={busy}
                onClick={close}
              >
                Close
              </Button>
            </ModalFooter>
          </>
        )
      )}
    </DefinitionModal>
  );
}
