"use client";

import { useMemo, useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DialogBody } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DefinitionGrid,
  DefinitionTile,
} from "@/components/monitoring/definition-grid";
import {
  DefinitionBlock,
  DefinitionModal,
  Disclosure,
  ModalFooter,
  useDefinitionParam,
} from "@/components/monitoring/definition-modal";
import { useTechnologies } from "@/components/monitoring/technologies-provider";
import { PlaybookForm } from "@/components/monitoring/playbook-form";
import { PlaybookDiffPanel } from "@/components/monitoring/playbook-diff";
import { CatalogueScopeSwitch } from "@/components/monitoring/catalogue-scope-switch";
import { Badge } from "@/components/ui/badge";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { diffMethod } from "@/lib/monitoring/playbook-diff";
import {
  SOURCE_LABEL,
  scopedUrl,
  type CatalogueScope,
} from "@/lib/monitoring/catalogue-scope";
import { formatDateTime } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import type {
  PlaybookSummary,
  PlaybookView,
} from "@/lib/monitoring/playbook";
import {
  OBSERVATION_SOURCE_LABEL,
} from "@/lib/monitoring/ui";

/**
 * The shelf, and the panel that opens over it.
 *
 * The shelf's data is server-rendered and tiny; the method itself — two screens
 * of prose and up to seventy observation specs — is fetched when a tile is
 * opened. The page previously downloaded all seven methods in full before it
 * could draw a single tile, and again after every save.
 */
export function PlaybooksBrowser({
  summaries,
  scope,
  canEditTemplates,
}: {
  summaries: PlaybookSummary[];
  /** The org's effective methods, or the shared templates (platform admins). */
  scope: CatalogueScope;
  canEditTemplates: boolean;
}) {
  const { label } = useTechnologies();
  const [openTechnology, setOpenTechnology] = useDefinitionParam("playbook");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={scope === "templates" ? "Playbook templates" : "Investigation playbooks"}
        description={
          scope === "templates"
            ? "The shared methods every organization inherits. An edit reaches every org that has not customized that method; orgs that have are told the template changed."
            : "How a deep assessment investigates each technology: where that engine's data lives, the order to look in, and the measurements it must bring back. Editing a shared method gives your organization its own copy, tuned to your clusters."
        }
      >
        {canEditTemplates && (
          <CatalogueScopeSwitch path="/admin/monitoring/profiles" scope={scope} />
        )}
      </AdminPageHeader>

      <Disclosure
        label="Why a method never decides what counts as a problem"
        summary={`${summaries.length} methods`}
      >
        <p className="max-w-[80ch] text-body-sm text-bone-gray">
          That stays in the check catalogue, because an agent that authors
          identity destroys the history. A playbook only says where to look and
          how to measure. An edit takes effect on the next run; every run stores
          the prompt it was actually given, so what produced an old answer stays
          readable on that run.
        </p>
      </Disclosure>

      <DefinitionGrid>
        {summaries.map((profile) => (
          <DefinitionTile
            key={profile.technology}
            id={profile.technology}
            title={label(profile.technology)}
            meta={
              profile.missing
                ? `${profile.checkCount} checks · no method yet — write one`
                : `${profile.checkCount} checks · ${profile.observationCount} measurements`
            }
            dimmed={profile.missing}
            marker={
              profile.missing
                ? "no playbook"
                : profile.updateAvailable
                ? "update"
                : profile.source !== "template"
                  ? SOURCE_LABEL[profile.source]
                  : profile.editedAt
                    ? "edited"
                    : undefined
            }
            onOpen={setOpenTechnology}
          />
        ))}
      </DefinitionGrid>

      {/* Keyed by the open method, so the panel always mounts in read mode with no
          note carried over. That reset used to be a setState during render. */}
      <PlaybookPanel
        key={openTechnology ?? "closed"}
        summary={
          summaries.find((p) => p.technology === openTechnology) ?? null
        }
        scope={scope}
        onClose={() => setOpenTechnology(null)}
      />
    </div>
  );
}

function PlaybookPanel({
  summary,
  scope,
  onClose,
}: {
  summary: PlaybookSummary | null;
  scope: CatalogueScope;
  onClose: () => void;
}) {
  const { label } = useTechnologies();
  const refresh = useRefreshThenNavigate();
  const url = summary
    ? scopedUrl(`/api/admin/monitoring/profiles/${summary.technology}`, scope)
    : "";
  const detail = useAdminData<{ profile: PlaybookView }>(url, [
    summary?.technology,
    scope,
  ]);
  const open = summary && detail.data ? detail.data.profile : null;
  // A type with no method yet has nothing to read — open straight into writing it.
  const [editing, setEditing] = useState(summary?.missing ?? false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** In an org's catalogue, editing a template creates the org's own copy. */
  const forks = scope === "org" && summary?.source === "template";
  // What the template changed relative to the org's copy, when it moved on.
  const templateDiff = useMemo(
    () =>
      open?.template && open.updateAvailable
        ? diffMethod(open, open.template, { detail: true })
        : null,
    [open],
  );

  /** Reset to template (DELETE) or keep the org's copy (reviewed); both close. */
  async function act(method: "DELETE" | "POST") {
    if (!summary) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(
        method === "DELETE" ? url : `/api/admin/monitoring/profiles/${summary.technology}/reviewed`,
        { method },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onClose();
      refresh(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
      setBusy(false);
    }
  }

  /**
   * Every way out of the panel — Escape, the overlay, the X, Cancel — comes
   * through here. A method is two screens of prose to retype.
   */
  function mayDiscard() {
    return !dirty || confirm("Discard your unsaved changes to this method?");
  }

  return (
    <DefinitionModal
      open={summary !== null}
      onClose={onClose}
      confirmClose={mayDiscard}
      title={
        summary ? label(summary.technology) : ""
      }
      badges={
        summary && (
          <span className="flex flex-wrap items-center gap-2 text-caption-tracked text-bone-gray">
            {scope === "org" && (
              <Badge variant="outline" className="text-bone-gray">
                {summary.missing ? "no playbook yet" : SOURCE_LABEL[summary.source]}
              </Badge>
            )}
            {summary.updateAvailable && (
              <span className="uppercase text-traffic-yellow">template updated</span>
            )}
            {summary.checkCount} checks · {summary.observationCount} measurements
            {/* Worth stating, because an edited method stops tracking the text
                this release ships — that is what `edited_by` guards. */}
            {summary.editedAt && ` · edited ${formatDateTime(summary.editedAt)}`}
          </span>
        )
      }
    >
      {detail.error ? (
        <DialogBody>
          <p className="text-body-sm text-traffic-red">{detail.error}</p>
        </DialogBody>
      ) : !open ? (
        <DialogBody className="space-y-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-20" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-24" />
        </DialogBody>
      ) : editing ? (
        <PlaybookForm
          playbook={open}
          scope={scope}
          onDirtyChange={setDirty}
          onCancel={() => {
            if (!mayDiscard()) return;
            setDirty(false);
            setEditing(false);
          }}
          onSaved={() => {
            /**
             * Saving closes the panel, as with a check. It used to stay open and
             * swap back to the read view, which remounted the body and lost your
             * place in it — after editing measurement 17 you were returned to the
             * top of a panel you were finished with.
             */
            setDirty(false);
            onClose();
            refresh(null);
          }}
        />
      ) : (
        <>
          <DialogBody className="space-y-4">
            {actionError && (
              <p className="text-body-sm text-traffic-red">{actionError}</p>
            )}
            {templateDiff && (
              <DefinitionBlock label="The shared template changed">
                <PlaybookDiffPanel diff={templateDiff} beforeLabel="your copy" />
              </DefinitionBlock>
            )}
            <p className="max-w-[90ch] text-body-sm text-pale-stone">
              {open.framing}
            </p>

            <DefinitionBlock label="Where the data is">
              <ul className="space-y-1.5">
                {open.dataSources.map((source, i) => (
                  <li
                    key={i}
                    className="max-w-[90ch] text-body-sm text-bone-gray"
                  >
                    {source}
                  </li>
                ))}
              </ul>
            </DefinitionBlock>

            <DefinitionBlock label="How to investigate, in order">
              <ol className="space-y-1.5">
                {open.method.map((step, i) => (
                  <li
                    key={i}
                    className="max-w-[90ch] text-body-sm text-bone-gray"
                  >
                    <span className="mr-2 font-mono text-[12px] text-pale-stone">
                      {i + 1}.
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </DefinitionBlock>

            {/* The one thing still folded away: these are reference data, read
                when you are checking a key rather than reading a method. */}
            <details className="border-t border-border pt-3">
              <summary className="cursor-pointer text-caption-tracked uppercase text-bone-gray transition-colors hover:text-warm-off-white">
                Measurements it must return ({open.observations.length})
              </summary>
              <p className="mt-2 max-w-[80ch] text-body-sm text-bone-gray">
                These are the keys the run is graded on. Most cannot be filled
                from a Kubernetes manifest, which is what forces a real
                investigation — and a key that comes back missing is named on the
                run rather than passing quietly.
              </p>
              <table className="mt-2 w-full text-body-sm">
                <tbody>
                  {open.observations.map((observation) => (
                    <tr
                      key={observation.key}
                      className="border-t border-border/60"
                    >
                      <td className="py-1 pr-3 align-top font-mono text-[12px] whitespace-nowrap text-pale-stone">
                        {observation.key}
                        {(open.readings[observation.key] ?? 0) > 0 && (
                          <span className="ml-2 font-sans text-caption-tracked uppercase text-bone-gray">
                            {open.readings[observation.key]} read
                          </span>
                        )}
                      </td>
                      <td className="py-1 pr-3 align-top text-caption-tracked whitespace-nowrap uppercase text-bone-gray">
                        {OBSERVATION_SOURCE_LABEL[observation.source] ??
                          observation.source}
                        {observation.unit && (
                          <span className="normal-case"> · {observation.unit}</span>
                        )}
                      </td>
                      <td className="py-1 align-top text-bone-gray">
                        {observation.how}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </DialogBody>

          <ModalFooter>
            <Button
              disabled={busy}
              onClick={() => setEditing(true)}
              title={
                forks
                  ? "Gives your organization its own copy; the shared method is unchanged"
                  : undefined
              }
            >
              {forks ? "Customize" : "Edit"}
            </Button>
            {open.updateAvailable && (
              <Button variant="outline" disabled={busy} onClick={() => act("POST")}>
                Keep my version
              </Button>
            )}
            {scope === "org" && open.source === "override" && (
              <ConfirmButton
                label="Reset to template"
                title="Reset to the shared method?"
                description="Your organization's copy is discarded and deep runs use the shared template from the next run on. Measurements already recorded keep their history."
                confirmLabel="Reset"
                disabled={busy}
                onConfirm={() => act("DELETE")}
              />
            )}
            <Button variant="ghost" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </>
      )}
    </DefinitionModal>
  );
}
