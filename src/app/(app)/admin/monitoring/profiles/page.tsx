"use client";

import { useState } from "react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DialogBody } from "@/components/ui/dialog";
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
import type { PlaybookView } from "@/lib/monitoring/playbook";
import {
  OBSERVATION_SOURCE_LABEL,
  TECHNOLOGY_LABEL,
} from "@/lib/monitoring/ui";

/**
 * Read and edit the playbooks.
 *
 * The rubric page answers "what is asked"; this answers "how it is investigated".
 * There is nothing else to answer: a method is edited and saved, so the page is a
 * shelf with an editor behind it — no versions, no comparison against the text
 * this release ships, no update to adopt or decline.
 *
 * Eight methods stacked on a page is not a reading surface, it is a document
 * nobody reads, so the page shows eight names and the method opens in a panel
 * wide enough to hold it — which the 900px column never was.
 */
export default function ProfilesPage() {
  const { data, loading, error, refetch } = useAdminData<{
    profiles: PlaybookView[];
  }>("/api/admin/monitoring/profiles", []);
  const [openTechnology, setOpenTechnology] = useDefinitionParam("playbook");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const profiles = data?.profiles ?? [];
  const open =
    profiles.find((p) => p.technology === openTechnology) ?? null;

  // A panel always opens in read mode — including one opened straight from a URL
  // or re-opened by Back — so editing stays the deliberate second step. Adjusted
  // during render rather than in an effect: the reset belongs to this render,
  // not to a pass after it.
  const [panelFor, setPanelFor] = useState(openTechnology);
  if (panelFor !== openTechnology) {
    setPanelFor(openTechnology);
    setEditing(false);
    setDirty(false);
    // The note belongs to the method that produced it, not to the next one.
    setNote(null);
  }

  /**
   * Every way out of the panel — Escape, the overlay, the X, Cancel — comes
   * through here. A method is two screens of prose to retype.
   */
  function mayDiscard() {
    return !dirty || confirm("Discard your unsaved changes to this method?");
  }

  function close() {
    setOpenTechnology(null);
  }

  if (error)
    return <p className="py-8 text-body-sm text-traffic-red">{error}</p>;
  if (loading || !data)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Investigation playbooks"
        description="How a deep assessment investigates each technology: where that engine's data lives, the order to look in, and the measurements it must bring back. The rubric says what is asked; this says how — and a deep run carries it verbatim in the prompt."
      />

      <Disclosure
        label="Why a method never decides what counts as a problem"
        summary={`${profiles.length} methods`}
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
        {profiles.map((profile) => (
          <DefinitionTile
            key={profile.technology}
            title={TECHNOLOGY_LABEL[profile.technology]}
            meta={`${profile.checkIds.length} checks · ${profile.observations.length} measurements`}
            marker={profile.editedAt ? "edited" : undefined}
            onOpen={() => setOpenTechnology(profile.technology)}
          />
        ))}
      </DefinitionGrid>

      <DefinitionModal
        open={open !== null}
        onClose={close}
        confirmClose={mayDiscard}
        title={open ? TECHNOLOGY_LABEL[open.technology] : ""}
        badges={
          open && (
            <span className="text-caption-tracked text-bone-gray">
              {open.checkIds.length} checks · {open.observations.length}{" "}
              measurements
              {/* Worth stating, because an edited method stops tracking the text
                  this release ships — that is what `edited_by` guards. */}
              {open.editedAt && ` · edited ${formatDateTime(open.editedAt)}`}
            </span>
          )
        }
      >
        {open &&
          (editing ? (
            <PlaybookForm
              playbook={open}
              onDirtyChange={setDirty}
              onCancel={() => {
                if (!mayDiscard()) return;
                setDirty(false);
                setEditing(false);
              }}
              onSaved={(saveNote) => {
                setDirty(false);
                setEditing(false);
                setNote(saveNote);
                refetch();
              }}
            />
          ) : (
            <>
              <DialogBody className="space-y-4">
                {/* Shown here rather than on the page behind: saving keeps the
                    panel open, and an ended trend is worth reading now. */}
                {note && (
                  <p className="text-body-sm text-traffic-yellow">{note}</p>
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

                {/* The one thing still folded away: these are reference data,
                    read when you are checking a key rather than reading a method. */}
                <details className="border-t border-border pt-3">
                  <summary className="cursor-pointer text-caption-tracked uppercase text-bone-gray transition-colors hover:text-warm-off-white">
                    Measurements it must return ({open.observations.length})
                  </summary>
                  <p className="mt-2 max-w-[80ch] text-body-sm text-bone-gray">
                    These are the keys the run is graded on. Most cannot be filled
                    from a Kubernetes manifest, which is what forces a real
                    investigation — and a key that comes back missing is named on
                    the run rather than passing quietly.
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
                              <span className="normal-case">
                                {" "}
                                · {observation.unit}
                              </span>
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
                <Button variant="ghost" className="ml-auto" onClick={close}>
                  Close
                </Button>
              </ModalFooter>
            </>
          ))}
      </DefinitionModal>
    </div>
  );
}
