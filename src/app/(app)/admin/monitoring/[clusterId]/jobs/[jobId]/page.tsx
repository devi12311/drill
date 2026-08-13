"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Play, Trash2 } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ConcernCard,
  type ConcernCheckInfo,
  type ConcernView,
} from "@/components/monitoring/concern-card";
import { formatDuration, formatRelative, formatUsd } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { CATEGORY_LABEL, RUN_STATUS_CLASS } from "@/lib/monitoring/ui";
import type { MonitorCategory } from "@/lib/monitoring/types";

interface RunRow {
  id: string;
  status: string;
  trigger: string;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  model: string | null;
  toolCallsTotal: number | null;
  toolCallsFailed: number | null;
  findingsNew: number | null;
  findingsResolved: number | null;
  findingsOpen: number | null;
  error: string | null;
  createdAt: string;
}

interface JobPayload {
  job: {
    id: string;
    name: string;
    type: MonitorCategory;
    model: string;
    schedule: string | null;
    enabled: boolean;
    targets: { kind: string; namespace: string; name: string }[];
  };
  concerns: ConcernView[];
  checks: (ConcernCheckInfo & { id: string })[];
}

const OPEN_ONLY = "open";

export default function JobPage({
  params,
}: {
  params: Promise<{ clusterId: string; jobId: string }>;
}) {
  const { clusterId, jobId } = use(params);
  const router = useRouter();
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<"run" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const concerns = useAdminData<JobPayload>(
    `/api/admin/monitoring/jobs/${jobId}/concerns${showAll ? "" : `?status=${OPEN_ONLY}`}`,
    [jobId, showAll],
  );
  const runs = useAdminData<{ runs: RunRow[] }>(
    `/api/admin/monitoring/jobs/${jobId}`,
    [jobId],
  );

  async function runNow() {
    setBusy("run");
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/monitoring/jobs/${jobId}/run`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.run?.error) setActionError(body.run.error);
      concerns.refetch();
      runs.refetch();
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Run failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm("Delete this job and its entire concern history?")) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/monitoring/jobs/${jobId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
      router.push(`/admin/monitoring/${clusterId}`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

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

  if (concerns.error)
    return <p className="py-8 text-body-sm text-traffic-red">{concerns.error}</p>;
  if (concerns.loading || !concerns.data)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  const { job } = concerns.data;
  const list = concerns.data.concerns;
  // The catalogue is live data, so titles/citations arrive with the response
  // rather than being imported by the card.
  const checkInfo = new Map(concerns.data.checks.map((c) => [c.id, c]));

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={job.name}
        description={`${CATEGORY_LABEL[job.type]} · ${job.targets.length} workload${job.targets.length === 1 ? "" : "s"} · ${job.schedule ? `schedule ${job.schedule} UTC` : "manual runs only"} · ${job.model}`}
      >
        <Button onClick={runNow} disabled={busy !== null}>
          <Play className="size-3.5" />
          {busy === "run" ? "Investigating…" : "Run now"}
        </Button>
        <Button
          variant="outline"
          className="text-traffic-red"
          onClick={remove}
          disabled={busy !== null}
          aria-label="Delete job"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </AdminPageHeader>

      {busy === "run" && (
        <Card className="p-4">
          <p className="text-body-sm text-pale-stone">
            Holmes is investigating {job.targets.length} workload
            {job.targets.length === 1 ? "" : "s"}. This takes tens of seconds to
            a few minutes — leaving the page does not cancel the run.
          </p>
        </Card>
      )}
      {actionError && (
        <p className="text-body-sm text-traffic-red">{actionError}</p>
      )}

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-body font-medium text-warm-off-white">
            {showAll ? "All concerns" : "Open concerns"}
            <span className="ml-2 text-body-sm text-bone-gray">
              {list.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-body-sm text-bone-gray underline-offset-4 hover:text-warm-off-white hover:underline"
          >
            {showAll ? "Show open only" : "Include resolved, muted and dismissed"}
          </button>
        </div>

        {list.length === 0 ? (
          <p className="py-6 text-body-sm text-bone-gray">
            {showAll
              ? "Nothing recorded yet — run the job to produce its first assessment."
              : "No open concerns. Either this job has not run yet, or everything it checks is currently passing."}
          </p>
        ) : (
          <div className="space-y-2">
            {list.map((concern) => (
              <ConcernCard
                key={concern.id}
                concern={concern}
                check={checkInfo.get(concern.checkId)}
                onChanged={() => {
                  concerns.refetch();
                  router.refresh();
                }}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">Run history</h2>
        {runs.error ? (
          <p className="text-body-sm text-traffic-red">{runs.error}</p>
        ) : (
          <DataTable
            columns={runColumns}
            rows={runs.data?.runs ?? []}
            getKey={(r) => r.id}
            empty="No runs yet."
          />
        )}
      </section>
    </div>
  );
}
