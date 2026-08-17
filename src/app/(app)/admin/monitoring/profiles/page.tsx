"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { PlaybookForm } from "@/components/monitoring/playbook-form";
import { formatDateTime } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";
import type { PlaybookView } from "@/lib/monitoring/playbook";
import {
  OBSERVATION_SOURCE_LABEL,
  TECHNOLOGY_LABEL,
} from "@/lib/monitoring/ui";
import { cn } from "@/lib/utils";

/**
 * Read and edit the playbooks.
 *
 * The rubric page answers "what is asked"; this answers "how it is investigated".
 * There is nothing else to answer: a method is edited and saved, so the page is a
 * reading surface with an editor behind it — no versions, no comparison against the
 * text this release ships, no update to adopt or decline.
 *
 * The method text is collapsed by default. Six full methods stacked is not a reading
 * surface, it is a document nobody reads; the framing paragraph stays visible
 * because it is the one part that says what the method is FOR.
 */

export default function ProfilesPage() {
  const { data, loading, error, refetch } = useAdminData<{
    profiles: PlaybookView[];
  }>("/api/admin/monitoring/profiles", []);
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  function toggle(technology: string) {
    setExpanded((prev) =>
      prev.includes(technology)
        ? prev.filter((t) => t !== technology)
        : [...prev, technology],
    );
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

      <Card className="space-y-3 p-4">
        <span className="text-body text-warm-off-white">
          {data.profiles.length} methods
        </span>
        <p className="max-w-[80ch] text-body-sm text-bone-gray">
          A playbook never decides what counts as a problem — that stays in the check
          catalogue, because an agent that authors identity destroys the history. It
          only says where to look and how to measure. An edit takes effect on the next
          run; every run stores the prompt it was actually given, so what produced an
          old answer stays readable on that run.
        </p>
      </Card>

      {note && (
        <p className="max-w-[100ch] text-body-sm text-traffic-yellow">{note}</p>
      )}

      {data.profiles.map((profile) => {
        const isEditing = editing === profile.technology;
        const isOpen = expanded.includes(profile.technology) || isEditing;

        return (
          <section
            key={profile.technology}
            id={`playbook-${profile.technology}`}
            className="scroll-mt-4 space-y-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => toggle(profile.technology)}
                aria-expanded={isOpen}
                className="flex items-center gap-1.5 text-body font-medium text-warm-off-white transition-colors hover:text-pale-stone"
              >
                {isOpen ? (
                  <ChevronDown className="size-3.5 text-bone-gray" />
                ) : (
                  <ChevronRight className="size-3.5 text-bone-gray" />
                )}
                {TECHNOLOGY_LABEL[profile.technology]}
              </button>
              <span className="text-body-sm text-bone-gray">
                {profile.checkIds.length} checks · {profile.observations.length}{" "}
                measurements
                {/* Worth stating, because an edited method stops tracking the text
                    this release ships — that is what `edited_by` guards. */}
                {profile.editedAt &&
                  ` · edited ${formatDateTime(profile.editedAt)}`}
              </span>
              <Button
                variant="outline"
                className="ml-auto"
                onClick={() => setEditing(isEditing ? null : profile.technology)}
              >
                {isEditing ? "Close" : "Edit"}
              </Button>
            </div>

            <Card className="space-y-4 p-4">
              {isEditing ? (
                <PlaybookForm
                  playbook={profile}
                  onCancel={() => setEditing(null)}
                  onSaved={(saveNote) => {
                    setEditing(null);
                    setNote(saveNote);
                    refetch();
                  }}
                />
              ) : (
                <>
                  <p
                    className={cn(
                      "max-w-[90ch] text-body-sm text-pale-stone",
                      !isOpen && "line-clamp-3",
                    )}
                  >
                    {profile.framing}
                  </p>

                  {!isOpen ? (
                    <button
                      type="button"
                      onClick={() => toggle(profile.technology)}
                      className="text-body-sm text-bone-gray transition-colors hover:text-warm-off-white"
                    >
                      Read the method — {profile.dataSources.length} data sources,{" "}
                      {profile.method.length} steps,{" "}
                      {profile.observations.length} measurements
                    </button>
                  ) : (
                    <>
                      <div className="space-y-1.5 border-t border-border pt-3">
                        <p className="text-caption-tracked uppercase text-bone-gray">
                          Where the data is
                        </p>
                        <ul className="space-y-1.5">
                          {profile.dataSources.map((source, i) => (
                            <li
                              key={i}
                              className="max-w-[90ch] text-body-sm text-bone-gray"
                            >
                              {source}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="space-y-1.5 border-t border-border pt-3">
                        <p className="text-caption-tracked uppercase text-bone-gray">
                          How to investigate, in order
                        </p>
                        <ol className="space-y-1.5">
                          {profile.method.map((step, i) => (
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
                      </div>

                      <details className="border-t border-border pt-3">
                        <summary className="cursor-pointer text-caption-tracked uppercase text-bone-gray transition-colors hover:text-warm-off-white">
                          Measurements it must return (
                          {profile.observations.length})
                        </summary>
                        <p className="mt-2 max-w-[80ch] text-body-sm text-bone-gray">
                          These are the keys the run is graded on. Most cannot be
                          filled from a Kubernetes manifest, which is what forces a
                          real investigation — and a key that comes back missing is
                          named on the run rather than passing quietly.
                        </p>
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full text-body-sm">
                            <tbody>
                              {profile.observations.map((observation) => (
                                <tr
                                  key={observation.key}
                                  className="border-t border-border/60"
                                >
                                  <td className="py-1 pr-3 align-top font-mono text-[12px] whitespace-nowrap text-pale-stone">
                                    {observation.key}
                                    {(profile.readings[observation.key] ?? 0) >
                                      0 && (
                                      <span className="ml-2 font-sans text-caption-tracked uppercase text-bone-gray">
                                        {profile.readings[observation.key]} read
                                      </span>
                                    )}
                                  </td>
                                  <td className="py-1 pr-3 align-top text-caption-tracked whitespace-nowrap uppercase text-bone-gray">
                                    {OBSERVATION_SOURCE_LABEL[
                                      observation.source
                                    ] ?? observation.source}
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
                        </div>
                      </details>
                    </>
                  )}
                </>
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
