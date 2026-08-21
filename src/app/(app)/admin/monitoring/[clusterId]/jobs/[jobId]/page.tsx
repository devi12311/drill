import Link from "next/link";
import { notFound } from "next/navigation";
import { isUuid } from "@/lib/monitoring/types";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AutoResolvedNotice } from "@/components/monitoring/auto-resolved-notice";
import { ConcernList } from "@/components/monitoring/concern-list";
import { JobActions } from "@/components/monitoring/job-actions";
import type { ConcernCheckInfo } from "@/components/monitoring/concern-card";
import { formatDuration, formatRelative, formatUsd } from "@/lib/admin/format";
import {
  getJob,
  listConcerns,
  listRuns,
  type RunRow,
} from "@/lib/db/monitoring-queries";
import { checkSummaries } from "@/lib/monitoring/checks";
import { CATEGORY_LABEL, DEPTH_LABEL, RUN_STATUS_CLASS } from "@/lib/monitoring/ui";

/**
 * One job: what it assesses, what it has found, and what it has done.
 *
 * Server-rendered. The client version made two fetches after hydration, one of
 * which — `/jobs/[id]/concerns` — carried the ENTIRE check catalogue (~126 KB of
 * questions and evidence) so the cards could print one title each. Here the
 * catalogue is read on the server and narrowed to the checks the listed concerns
 * actually cite, which for a typical job is a handful of rows.
 *
 * The open/all switch is a URL param rather than client state, so it is linkable
 * and the resolved concerns nobody asked for are never fetched.
 */
export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ clusterId: string; jobId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { clusterId, jobId } = await params;
  if (!isUuid(clusterId) || !isUuid(jobId)) notFound();
  const showAll = (await searchParams).status === "all";

  const [job, concerns, runs, catalogue] = await Promise.all([
    getJob(jobId),
    listConcerns(jobId, showAll ? {} : { statuses: ["open"] }),
    listRuns(jobId, 20),
    checkSummaries(),
  ]);
  if (!job) notFound();

  /**
   * Only the checks these concerns cite. The whole catalogue used to travel with
   * every concerns response for exactly this two-field lookup.
   */
  const cited = new Set(concerns.map((c) => c.checkId));
  const checkInfo: Record<string, ConcernCheckInfo> = {};
  for (const check of catalogue) {
    if (cited.has(check.id))
      checkInfo[check.id] = { title: check.title, reference: check.reference };
  }

  const cluster = job.targets.some((t) => t.kind === "cluster");
  // Paused is only meaningful for a scheduled job: `enabled` gates the scheduler
  // tick alone, and "Run now" works either way.
  const scheduleLabel = job.schedule
    ? `schedule ${job.schedule} UTC${job.enabled ? "" : " · paused"}`
    : "manual runs only";
  const scopeLabel = cluster
    ? "the cluster itself"
    : `${job.targets.length} workload${job.targets.length === 1 ? "" : "s"}`;
  const scopeNote = `Holmes is investigating ${scopeLabel}. ${
    cluster
      ? "One investigation covers the control plane, the nodes, scheduling, DNS, the pod network, storage and clusterwide workload health — the widest run in the system, and it is given up to 45 minutes."
      : job.depth === "deep"
        ? "A deep run investigates each workload separately, one after another — expect several minutes each, and up to 20 per workload before it is given up on."
        : "This takes tens of seconds to a few minutes."
  }`;

  const runColumns: Column<RunRow>[] = [
    {
      key: "createdAt",
      header: "Run",
      render: (r) => (
        <Link
          href={`/admin/monitoring/${clusterId}/jobs/${jobId}/runs/${r.id}`}
          className="text-warm-off-white hover:underline"
        >
          {formatRelative(r.finishedAt ?? r.createdAt)}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <span className={RUN_STATUS_CLASS[r.status] ?? "text-bone-gray"}>
          {r.status}
        </span>
      ),
    },
    {
      key: "findings",
      header: "New / resolved / open",
      align: "right",
      render: (r) =>
        r.status === "completed"
          ? `${r.findingsNew ?? 0} / ${r.findingsResolved ?? 0} / ${r.findingsOpen ?? 0}`
          : "—",
    },
    {
      key: "tools",
      header: "Tools",
      align: "right",
      render: (r) =>
        r.toolCallsTotal === null ? (
          "—"
        ) : r.toolCallsFailed ? (
          <span
            className="text-traffic-yellow"
            title="Some tools failed — Holmes carries on with missing data, so this run may be incomplete"
          >
            {r.toolCallsTotal - r.toolCallsFailed}/{r.toolCallsTotal}
          </span>
        ) : (
          <span className="text-bone-gray">{r.toolCallsTotal}</span>
        ),
    },
    {
      key: "durationMs",
      header: "Took",
      align: "right",
      render: (r) => (r.durationMs ? formatDuration(r.durationMs) : "—"),
    },
    {
      key: "costUsd",
      header: "Cost",
      align: "right",
      render: (r) => (r.costUsd === null ? "—" : formatUsd(r.costUsd)),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={job.name}
        description={`${CATEGORY_LABEL[job.type]} · ${DEPTH_LABEL[job.depth]} · ${scopeLabel} · ${scheduleLabel} · ${job.model}`}
      >
        <JobActions
          clusterId={clusterId}
          jobId={jobId}
          scopeNote={scopeNote}
        />
      </AdminPageHeader>

      <AutoResolvedNotice />

      <ConcernList
        concerns={concerns.map((c) => ({
          id: c.id,
          checkId: c.checkId,
          targetKind: c.targetKind,
          targetNamespace: c.targetNamespace,
          targetName: c.targetName,
          scope: c.scope,
          baseSeverity: c.baseSeverity,
          effectiveSeverity: c.effectiveSeverity,
          severityRationale: c.severityRationale,
          status: c.status,
          title: c.title,
          rationale: c.rationale,
          remediation: c.remediation,
          evidence: c.evidence,
          firstSeenAt: c.firstSeenAt.toISOString(),
          lastSeenAt: c.lastSeenAt.toISOString(),
          occurrenceCount: c.occurrenceCount,
          dismissalComment: c.dismissalComment,
        }))}
        checkInfo={checkInfo}
        showAll={showAll}
      />

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">Run history</h2>
        <DataTable
          columns={runColumns}
          rows={runs}
          getKey={(r) => r.id}
          empty="No runs yet."
        />
      </section>
    </div>
  );
}
