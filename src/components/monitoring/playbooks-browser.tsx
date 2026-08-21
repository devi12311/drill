"use client";

import { useState } from "react";
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
import { PlaybookForm } from "@/components/monitoring/playbook-form";
import { formatDateTime } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { useRefreshThenNavigate } from "@/lib/admin/use-refresh-then-navigate";
import type {
  PlaybookSummary,
  PlaybookView,
} from "@/lib/monitoring/playbook";
import type { WorkloadTechnology } from "@/lib/monitoring/types";
import {
  OBSERVATION_SOURCE_LABEL,
  TECHNOLOGY_LABEL,
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
}: {
  summaries: PlaybookSummary[];
}) {
  const [openTechnology, setOpenTechnology] = useDefinitionParam("playbook");

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Investigation playbooks"
        description="How a deep assessment investigates each technology: where that engine's data lives, the order to look in, and the measurements it must bring back. The rubric says what is asked; this says how — and a deep run carries it verbatim in the prompt."
      />

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
            title={TECHNOLOGY_LABEL[profile.technology]}
            meta={`${profile.checkCount} checks · ${profile.observationCount} measurements`}
            marker={profile.editedAt ? "edited" : undefined}
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
        onClose={() => setOpenTechnology(null)}
      />
    </div>
  );
}

function PlaybookPanel({
  summary,
  onClose,
}: {
  summary: PlaybookSummary | null;
  onClose: () => void;
}) {
  const refresh = useRefreshThenNavigate();
  const detail = useAdminData<{ profile: PlaybookView }>(
    summary ? `/api/admin/monitoring/profiles/${summary.technology}` : "",
    [summary?.technology],
  );
  const open = summary && detail.data ? detail.data.profile : null;
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);

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
        summary ? TECHNOLOGY_LABEL[summary.technology as WorkloadTechnology] : ""
      }
      badges={
        summary && (
          <span className="text-caption-tracked text-bone-gray">
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
            <Button onClick={() => setEditing(true)}>Edit</Button>
            <Button variant="ghost" className="ml-auto" onClick={onClose}>
              Close
            </Button>
          </ModalFooter>
        </>
      )}
    </DefinitionModal>
  );
}
