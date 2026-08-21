import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { RunPrompts } from "@/components/monitoring/run-prompts";
import { SeverityBadge } from "@/components/monitoring/severity-badge";
import { formatDateTime, formatDuration, formatUsd } from "@/lib/admin/format";
import {
  getRun,
  getRunFindings,
  getRunObservations,
  runPromptIndex,
} from "@/lib/db/monitoring-queries";
import { checkSummaries } from "@/lib/monitoring/checks";
import {
  OBSERVATION_SOURCE_LABEL,
  RUN_STATUS_CLASS,
  TECHNOLOGY_LABEL,
} from "@/lib/monitoring/ui";
import {
  targetLabel,
  targetNamespaceLabel,
  isUuid,
} from "@/lib/monitoring/types";
import type { ObservationSource } from "@/lib/monitoring/types";

interface RunObservation {
  targetKind: string;
  targetNamespace: string;
  targetName: string;
  key: string;
  value: string;
  numeric: number | null;
  unit: string;
  source: ObservationSource;
}

function targetOf(t: { kind: string; namespace: string; name: string }) {
  return `${t.kind}/${t.namespace}/${t.name}`;
}

function shortKind(kind: string) {
  return kind === "statefulset" ? "sts" : "deploy";
}

/**
 * One run, server-rendered.
 *
 * The client version fetched `/api/admin/monitoring/runs/[id]` after hydration —
 * a payload that carried the whole check catalogue AND every verbatim prompt the
 * run sent, all of it parsed and put in the DOM whether or not anyone opened a
 * `<details>`. The prompts are now indexed by label and size and fetched one at a
 * time; the catalogue is read here and narrowed to the checks this run mentions.
 */
export default async function RunPage({
  params,
}: {
  params: Promise<{ clusterId: string; jobId: string; runId: string }>;
}) {
  const { clusterId, jobId, runId } = await params;
  if (!isUuid(jobId) || !isUuid(runId)) notFound();
  const [runRow, findings, observations, catalogue, prompts] =
    await Promise.all([
      getRun(runId),
      getRunFindings(runId),
      getRunObservations(runId),
      checkSummaries(),
      runPromptIndex(runId),
    ]);
  if (!runRow) notFound();

  const run = runRow;
  /**
   * What the run was SUPPOSED to measure, sent alongside what it did measure so the
   * page can name the missing readings — a measurement that never came back is the
   * whole reason observations exist, and it is invisible from the data alone.
   *
   * Taken from the run's own snapshot and never re-derived: methods are editable, so
   * today's playbook would grade an old run against questions it was never asked. A
   * run older than the column shows no measurement panel, which is the honest answer.
   */
  const expected = run.expectedObservations ?? [];
  // Only the checks this run mentions, rather than all ~180 of them.
  const mentioned = new Set([
    ...findings.map((f) => f.checkId),
    ...(run.coverage?.targets.flatMap((t) => [
      ...t.evaluated,
      ...t.skipped.map((s) => s.checkId),
    ]) ?? []),
  ]);
  const checkTitle = new Map(
    catalogue.filter((c) => mentioned.has(c.id)).map((c) => [c.id, c.title]),
  );
  const skippedTotal =
    run.coverage?.targets.reduce((n, t) => n + t.skipped.length, 0) ?? 0;
  // Grouped per workload, and matched against what the playbook asked for, so a
  // reading that never came back is named rather than merely absent.
  // One pass, pushing into the bucket. It used to rebuild the array on every
  // observation (`[...(observed.get(key) ?? []), observation]`), which is
  // quadratic in the readings for a single workload.
  const observed = new Map<string, RunObservation[]>();
  for (const observation of observations) {
    const key = targetOf({
      kind: observation.targetKind,
      namespace: observation.targetNamespace,
      name: observation.targetName,
    });
    const bucket = observed.get(key);
    if (bucket) bucket.push(observation);
    else observed.set(key, [observation]);
  }
  const measurements = expected.map((entry) => {
    const rows = observed.get(targetOf(entry.target)) ?? [];
    const gotKeys = new Set(rows.map((r) => r.key));
    return {
      ...entry,
      rows,
      missing: entry.keys.filter((key) => !gotKeys.has(key)),
    };
  });

  return (
    <div className="space-y-8">
      <Link
        href={`/admin/monitoring/${clusterId}/jobs/${jobId}`}
        className="inline-flex items-center gap-1.5 text-body-sm text-bone-gray hover:text-warm-off-white"
      >
        <ArrowLeft className="size-3.5" />
        Back to job
      </Link>

      <AdminPageHeader
        title={`Run — ${formatDateTime(run.finishedAt ?? run.createdAt)}`}
        description={
          <>
            <span className={RUN_STATUS_CLASS[run.status] ?? ""}>
              {run.status}
            </span>
            {" · "}
            {run.trigger} · {run.model ?? "—"} ·{" "}
            {run.durationMs ? formatDuration(run.durationMs) : "—"} ·{" "}
            {run.costUsd === null ? "—" : formatUsd(run.costUsd)}
          </>
        }
      />

      {run.error && (
        <Card className="border-traffic-red/40 p-4">
          <p className="text-caption-tracked uppercase text-bone-gray">
            Run failed
          </p>
          <p className="mt-1 text-body-sm text-traffic-red">{run.error}</p>
        </Card>
      )}

      {/* Honesty panel. A clean-looking assessment resting on failed tools or
          skipped checks is the most dangerous output this feature can produce,
          so it is stated before the findings, not buried after them. */}
      {(run.toolCallsFailed ?? 0) > 0 && (
        <Card className="border-traffic-yellow/40 p-4">
          <p className="text-body-sm text-traffic-yellow">
            {run.toolCallsFailed} of {run.toolCallsTotal} tool calls failed.
            Holmes continues with missing data, so treat this run as incomplete.
          </p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">
          Reported this run
          <span className="ml-2 text-body-sm text-bone-gray">
            {findings.length}
          </span>
        </h2>
        {findings.length === 0 ? (
          <p className="text-body-sm text-bone-gray">
            Nothing failed in this run.
          </p>
        ) : (
          <div className="space-y-1.5">
            {findings.map((finding) => (
              <Card
                key={finding.concernId}
                className="flex flex-wrap items-center gap-2 p-3"
              >
                <SeverityBadge
                  severity={finding.severity}
                  base={finding.baseSeverity}
                />
                <span className="font-mono text-[12px] text-muted-cobalt">
                  {finding.checkId}
                </span>
                <span className="min-w-0 flex-1 text-body-sm text-pale-stone">
                  {finding.title}
                </span>
                <span className="font-mono text-[12px] text-bone-gray">
                  {targetLabel({
                    kind: finding.targetKind,
                    name: finding.targetName,
                  })}
                </span>
                {finding.isNew && (
                  <span className="text-caption-tracked uppercase text-traffic-yellow">
                    new
                  </span>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      {measurements.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-body font-medium text-warm-off-white">
            Measurements
          </h2>
          <p className="max-w-[70ch] text-body-sm text-bone-gray">
            What this run actually read, and where from. Most of these values are
            impossible to obtain from a Kubernetes manifest, so a reading tagged{" "}
            {OBSERVATION_SOURCE_LABEL.metrics.toLowerCase()} or{" "}
            {OBSERVATION_SOURCE_LABEL.engine.toLowerCase()} is evidence the agent
            went and looked — and a missing one is evidence it did not.
          </p>

          {measurements.map((entry) => (
            <Card key={targetOf(entry.target)} className="p-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <p className="font-mono text-[12px] text-warm-off-white">
                  {shortKind(entry.target.kind)}/{entry.target.name}
                </p>
                <span className="text-caption-tracked uppercase text-bone-gray">
                  {TECHNOLOGY_LABEL[entry.technology]}
                </span>
                <span
                  className={
                    entry.missing.length > 0
                      ? "text-body-sm text-traffic-yellow"
                      : "text-body-sm text-bone-gray"
                  }
                >
                  {entry.rows.length} of {entry.keys.length} measured
                </span>
              </div>

              {entry.rows.length > 0 && (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-body-sm">
                    <tbody>
                      {entry.rows.map((row) => (
                        <tr key={row.key} className="border-t border-border/60">
                          <td className="py-1 pr-3 font-mono text-[12px] text-pale-stone">
                            {row.key}
                          </td>
                          <td className="py-1 pr-3 font-mono text-[12px] text-warm-off-white">
                            {row.value}
                            {row.unit && (
                              <span className="text-bone-gray"> {row.unit}</span>
                            )}
                          </td>
                          <td className="py-1 text-caption-tracked uppercase text-bone-gray">
                            {OBSERVATION_SOURCE_LABEL[row.source] ?? row.source}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {entry.missing.length > 0 && (
                <p className="mt-3 border-t border-border pt-2 text-body-sm text-bone-gray">
                  <span className="text-traffic-yellow">Not measured:</span>{" "}
                  <span className="font-mono text-[12px]">
                    {entry.missing.join(", ")}
                  </span>
                </p>
              )}
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-body font-medium text-warm-off-white">Coverage</h2>
          {skippedTotal > 0 && (
            <span className="text-body-sm text-traffic-yellow">
              {skippedTotal} check{skippedTotal === 1 ? "" : "s"} could not be
              evaluated
            </span>
          )}
        </div>
        <p className="max-w-[70ch] text-body-sm text-bone-gray">
          A check Holmes could not judge is recorded as skipped, never as a pass
          — and a skipped check leaves its concern untouched rather than
          resolving it.
        </p>

        {run.coverage?.targets.map((entry) => (
          <Card key={`${entry.target.namespace}/${entry.target.name}`} className="p-4">
            <p className="font-mono text-[12px] text-warm-off-white">
              {targetLabel(entry.target)}{" "}
              {targetNamespaceLabel(entry.target) && (
                <span className="text-bone-gray">
                  in {targetNamespaceLabel(entry.target)}
                </span>
              )}
            </p>
            <p className="mt-1 text-body-sm text-bone-gray">
              {entry.evaluated.length} evaluated
              {entry.skipped.length > 0 && `, ${entry.skipped.length} skipped`}
            </p>
            {/* Which sources answered is DERIVED from the measurements, never
                asserted by the model: a source counts as reached only because a
                fact came back from it. */}
            {entry.sourcesUsed.length > 0 && (
              <p className="mt-1 text-body-sm text-bone-gray">
                Sources reached:{" "}
                <span className="text-pale-stone">
                  {entry.sourcesUsed
                    .map((s) => OBSERVATION_SOURCE_LABEL[s] ?? s)
                    .join(", ")}
                </span>
              </p>
            )}
            {entry.sourcesUnavailable.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {entry.sourcesUnavailable.map((silent) => (
                  <li key={silent.source} className="text-body-sm">
                    <span className="text-traffic-yellow">
                      {OBSERVATION_SOURCE_LABEL[silent.source] ?? silent.source}{" "}
                      unavailable
                    </span>
                    <span className="text-bone-gray"> — {silent.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {entry.skipped.length > 0 && (
              <ul className="mt-2 space-y-1">
                {entry.skipped.map((skip) => (
                  <li key={skip.checkId} className="text-body-sm">
                    <span className="font-mono text-[12px] text-muted-cobalt">
                      {skip.checkId}
                    </span>{" "}
                    <span className="text-pale-stone">
                      {checkTitle.get(skip.checkId) ?? ""}
                    </span>
                    <span className="block text-bone-gray">{skip.reason}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}

        {run.coverage?.summary && (
          <Card className="p-4">
            <p className="text-caption-tracked uppercase text-bone-gray">
              Summary
            </p>
            <p className="mt-1 text-body-sm text-pale-stone">
              {run.coverage.summary}
            </p>
          </Card>
        )}
      </section>

      {prompts.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-medium text-warm-off-white">
            What the agent was told
          </h2>
          <p className="max-w-[70ch] text-body-sm text-bone-gray">
            The exact prompt sent for each call, stored verbatim. A playbook edit or
            a check edit makes the original unreconstructable, so reviewing the method
            a run actually used has to mean reading what was sent — not re-deriving it
            from today&apos;s code.
          </p>
          <RunPrompts runId={runId} entries={prompts} />
        </section>
      )}

      {run.rejected && run.rejected.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-body font-medium text-warm-off-white">
            Discarded output
          </h2>
          <p className="max-w-[70ch] text-body-sm text-bone-gray">
            Findings Drill refused to store, because identity must come from the
            rubric rather than the model.
          </p>
          <ul className="space-y-1">
            {run.rejected.map((reason, i) => (
              <li key={i} className="font-mono text-[12px] text-traffic-yellow">
                {reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
