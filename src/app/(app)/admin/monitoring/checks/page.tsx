"use client";

import { useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DialogBody } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import { REQUIREMENT_LABEL } from "@/lib/monitoring/catalogue";
import { useAdminData } from "@/lib/admin/use-admin-data";
import {
  CATEGORY_LABEL,
  SEVERITY_CLASS,
  describeScope,
} from "@/lib/monitoring/ui";
import { MONITOR_CATEGORIES } from "@/lib/monitoring/types";
import type { CheckRequirement } from "@/lib/monitoring/catalogue";
import type { CheckView } from "@/lib/monitoring/types";

/**
 * The live rubric. Built-in checks are seeded from the code definitions on first
 * read and can be retuned or disabled here without a deploy; custom checks are
 * added alongside them. A check's ID never changes, because concerns reference
 * it by value.
 *
 * The page is a shelf, not a document. Thirty checks each printing their
 * question, their scope and three action buttons was four screens of prose and
 * ninety buttons — so a tile carries only what you scan by (severity, name, ID,
 * whether it still runs) and everything the check SAYS waits in the modal.
 */
export default function ChecksPage() {
  const { data, loading, error, refetch } = useAdminData<{
    checks: CheckView[];
  }>("/api/admin/monitoring/checks", []);
  const [openId, setOpenId] = useDefinitionParam("check");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const checks = useMemo(() => data?.checks ?? [], [data]);
  const creating = openId === "new";
  const open = creating ? null : (checks.find((c) => c.id === openId) ?? null);

  // A panel always opens in read mode — including one opened straight from a URL
  // or re-opened by Back — so editing stays the deliberate second step. Adjusted
  // during render rather than in an effect: the reset belongs to this render,
  // not to a pass after it.
  const [panelFor, setPanelFor] = useState(openId);
  if (panelFor !== openId) {
    setPanelFor(openId);
    setEditing(false);
    setDirty(false);
    // Messages belong to the check that produced them, not to the next one.
    setNotice(null);
    setActionError(null);
  }

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return checks;
    return checks.filter((c) =>
      `${c.id} ${c.title} ${c.question}`.toLowerCase().includes(needle),
    );
  }, [checks, query]);

  /**
   * Every way out of the panel — Escape, the overlay, the X, Cancel — comes
   * through here, because an editor that discards silently is one stray click
   * away from losing a rewritten check.
   */
  function mayDiscard() {
    return !dirty || confirm("Discard your unsaved changes to this check?");
  }

  function close() {
    setOpenId(null);
  }

  function leaveEditor() {
    if (!mayDiscard()) return;
    setDirty(false);
    if (creating) close();
    else setEditing(false);
  }

  async function toggle(check: CheckView) {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/admin/monitoring/checks/${check.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !check.enabled }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.autoResolved > 0)
        setNotice(
          `${check.id} disabled — ${body.autoResolved} open concern(s) were closed, because a check that no longer runs can never be re-checked.`,
        );
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(check: CheckView) {
    if (!confirm(`Delete ${check.id}? Disabling is usually safer.`)) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/checks/${check.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      close();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

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
          placeholder="Filter by ID, title or question"
          className="pl-8"
          aria-label="Filter checks"
          autoComplete="off"
        />
      </div>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        MONITOR_CATEGORIES.map((category) => {
          const all = checks.filter((c) => c.category === category);
          const shown = matches.filter((c) => c.category === category);
          if (shown.length === 0) return null;
          return (
            <DefinitionSection
              key={category}
              title={CATEGORY_LABEL[category]}
              note={
                query.trim()
                  ? `${shown.length} of ${all.length} shown`
                  : `${all.filter((c) => c.enabled).length} of ${all.length} active`
              }
            >
              <DefinitionGrid>
                {shown.map((check) => (
                  <DefinitionTile
                    key={check.id}
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
                    onOpen={() => setOpenId(check.id)}
                  />
                ))}
              </DefinitionGrid>
            </DefinitionSection>
          );
        })
      )}

      <DefinitionModal
        open={creating || open !== null}
        onClose={close}
        title={creating ? "New check" : (open?.title ?? "")}
        identifier={creating ? undefined : open?.id}
        confirmClose={mayDiscard}
        badges={
          open && (
            <>
              <SeverityBadge severity={open.baseSeverity} />
              <Badge variant="outline" className="text-bone-gray">
                {open.builtin ? "built-in" : "custom"}
              </Badge>
              {open.version > 1 && (
                <span className="text-caption-tracked text-bone-gray">
                  v{open.version}
                </span>
              )}
              {!open.enabled && (
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
            check={open ?? undefined}
            onCancel={leaveEditor}
            onDirtyChange={setDirty}
            onSaved={(saved) => {
              setDirty(false);
              // A new check keeps the panel open on its own ID, so the thing you
              // just authored is the thing you are looking at.
              if (creating) setOpenId(saved.id);
              else setEditing(false);
              refetch();
            }}
          />
        ) : (
          open && (
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
                    {open.question}
                  </p>
                </DefinitionBlock>

                <DefinitionBlock label="Evidence it must cite">
                  <p className="max-w-[90ch] text-body-sm text-bone-gray">
                    {open.evidence}
                  </p>
                </DefinitionBlock>

                <DefinitionBlock label="Scope">
                  <p className="text-body-sm text-bone-gray">
                    {describeScope(open)}
                  </p>
                  {open.requires && (
                    <p className="text-body-sm text-bone-gray">
                      Needs{" "}
                      {REQUIREMENT_LABEL[open.requires as CheckRequirement] ??
                        open.requires}
                      . Where it is unavailable the check is skipped, never
                      passed.
                    </p>
                  )}
                  {open.resolveAfterAbsentRuns > 1 && (
                    <p className="text-body-sm text-bone-gray">
                      Auto-resolves after {open.resolveAfterAbsentRuns} clean
                      runs.
                    </p>
                  )}
                </DefinitionBlock>

                {open.reference && (
                  <DefinitionBlock label="Cites">
                    <p className="text-body-sm text-bone-gray">
                      {open.reference}
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
                  onClick={() => toggle(open)}
                >
                  {open.enabled ? "Disable" : "Enable"}
                </Button>
                {!open.builtin && (
                  <Button
                    variant="outline"
                    className="text-traffic-red"
                    disabled={busy}
                    onClick={() => remove(open)}
                  >
                    Delete
                  </Button>
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
    </div>
  );
}
