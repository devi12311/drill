"use client";

import Link from "next/link";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { Card } from "@/components/ui/card";
import { SeverityBadge } from "@/components/monitoring/severity-badge";
import { formatDateTime, formatDuration, formatUsd } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { RUN_STATUS_CLASS } from "@/lib/monitoring/ui";
import type { RunCoverage, Severity } from "@/lib/monitoring/types";

interface RunFinding {
  concernId: string;
  checkId: string;
  severity: Severity;
  baseSeverity: Severity;
  isNew: boolean;
  title: string;
  targetKind: string;
  targetNamespace: string;
  targetName: string;
}

interface RunPayload {
  run: {
    id: string;
    status: string;
    trigger: string;
    model: string | null;
    costUsd: number | null;
    totalTokens: number | null;
    durationMs: number | null;
    toolCallsTotal: number | null;
    toolCallsFailed: number | null;
    findingsNew: number | null;
    findingsResolved: number | null;
    findingsOpen: number | null;
    coverage: RunCoverage | null;
    rejected: string[] | null;
    error: string | null;
    finishedAt: string | null;
    createdAt: string;
  };
  findings: RunFinding[];
  checks: { id: string; title: string; reference: string }[];
}

export default function RunPage({
  params,
}: {
  params: Promise<{ clusterId: string; jobId: string; runId: string }>;
}) {
  const { clusterId, jobId, runId } = use(params);
  const { data, loading, error } = useAdminData<RunPayload>(
    `/api/admin/monitoring/runs/${runId}`,
    [runId],
  );

  if (error)
    return <p className="py-8 text-body-sm text-traffic-red">{error}</p>;
  if (loading || !data)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  const { run, findings, checks } = data;
  const checkTitle = new Map(checks.map((c) => [c.id, c.title]));
  const skippedTotal =
    run.coverage?.targets.reduce((n, t) => n + t.skipped.length, 0) ?? 0;

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
                  {finding.targetKind === "statefulset" ? "sts" : "deploy"}/
                  {finding.targetName}
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
              {entry.target.kind === "statefulset" ? "sts" : "deploy"}/
              {entry.target.name}{" "}
              <span className="text-bone-gray">
                in {entry.target.namespace}
              </span>
            </p>
            <p className="mt-1 text-body-sm text-bone-gray">
              {entry.evaluated.length} evaluated
              {entry.skipped.length > 0 && `, ${entry.skipped.length} skipped`}
            </p>
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
