"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Gauge, RefreshCw, ShieldCheck } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatNumber, formatRelative } from "@/lib/admin/format";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { CATEGORY_LABEL } from "@/lib/monitoring/ui";
import type { MonitorCategory, WorkloadKind } from "@/lib/monitoring/types";

interface ClusterDetail {
  cluster: {
    id: string;
    name: string;
    holmesUrl: string;
    lastDiscoveredAt: string | null;
    lastValidatedAt: string | null;
    discoveryError: string | null;
  };
  workloads: {
    kind: WorkloadKind;
    namespace: string;
    name: string;
    replicas: number | null;
    images: string[];
  }[];
  jobs: {
    id: string;
    name: string;
    type: MonitorCategory;
    enabled: boolean;
    schedule: string | null;
    targetCount: number;
    openConcerns: number;
    criticalConcerns: number;
    lastRunAt: string | null;
  }[];
}

export default function ClusterPage({
  params,
}: {
  params: Promise<{ clusterId: string }>;
}) {
  const { clusterId } = use(params);
  const router = useRouter();
  const { data, loading, error, refetch } = useAdminData<ClusterDetail>(
    `/api/admin/monitoring/clusters/${clusterId}`,
    [clusterId],
  );
  const [busy, setBusy] = useState<"discover" | "delete" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function discover() {
    setBusy("discover");
    setActionError(null);
    try {
      const res = await fetch(
        `/api/admin/monitoring/clusters/${clusterId}/discover`,
        { method: "POST" },
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      refetch();
      router.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Discovery failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (
      !confirm(
        "Delete this cluster? Its monitoring jobs and their entire concern history go with it.",
      )
    )
      return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/admin/monitoring/clusters/${clusterId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
      router.push("/admin/monitoring");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  const workloadColumns: Column<ClusterDetail["workloads"][number]>[] = [
    {
      key: "kind",
      header: "Kind",
      render: (w) => (
        <span className="font-mono text-[12px] text-bone-gray">
          {w.kind === "statefulset" ? "sts" : "deploy"}
        </span>
      ),
    },
    { key: "namespace", header: "Namespace", render: (w) => w.namespace },
    {
      key: "name",
      header: "Name",
      render: (w) => <span className="text-warm-off-white">{w.name}</span>,
    },
    {
      key: "replicas",
      header: "Replicas",
      align: "right",
      render: (w) => (w.replicas === null ? "—" : formatNumber(w.replicas)),
    },
  ];

  const jobColumns: Column<ClusterDetail["jobs"][number]>[] = [
    {
      key: "name",
      header: "Job",
      render: (j) => (
        <Link
          href={`/admin/monitoring/${clusterId}/jobs/${j.id}`}
          className="inline-flex items-center gap-2 text-warm-off-white hover:underline"
        >
          {j.type === "security" ? (
            <ShieldCheck className="size-3.5 text-bone-gray" />
          ) : (
            <Gauge className="size-3.5 text-bone-gray" />
          )}
          {j.name}
        </Link>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (j) => (
        <span className="text-bone-gray">{CATEGORY_LABEL[j.type]}</span>
      ),
    },
    {
      key: "targetCount",
      header: "Workloads",
      align: "right",
      render: (j) => formatNumber(j.targetCount),
    },
    {
      key: "openConcerns",
      header: "Open",
      align: "right",
      render: (j) =>
        j.openConcerns > 0 ? (
          <span
            className={
              j.criticalConcerns > 0 ? "text-traffic-red" : "text-traffic-yellow"
            }
          >
            {formatNumber(j.openConcerns)}
          </span>
        ) : (
          <span className="text-bone-gray">0</span>
        ),
    },
    {
      key: "schedule",
      header: "Schedule",
      render: (j) =>
        j.schedule ? (
          <span className="font-mono text-[12px] text-bone-gray">
            {j.schedule}
          </span>
        ) : (
          <span className="text-bone-gray">manual</span>
        ),
    },
    {
      key: "lastRunAt",
      header: "Last run",
      align: "right",
      render: (j) => formatRelative(j.lastRunAt),
    },
  ];

  if (error)
    return <p className="py-8 text-body-sm text-traffic-red">{error}</p>;
  if (loading || !data)
    return <p className="py-8 text-body-sm text-bone-gray">Loading…</p>;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title={data.cluster.name}
        description={
          <>
            Investigated by{" "}
            <span className="font-mono text-[12px]">
              {data.cluster.holmesUrl}
            </span>
            . Inventory refreshed {formatRelative(data.cluster.lastDiscoveredAt)}.
          </>
        }
      >
        <Button
          variant="outline"
          onClick={discover}
          disabled={busy !== null}
        >
          <RefreshCw className="size-3.5" />
          {busy === "discover" ? "Scanning…" : "Rescan workloads"}
        </Button>
        <Button asChild>
          <Link href={`/admin/monitoring/${clusterId}/jobs/new`}>New job</Link>
        </Button>
      </AdminPageHeader>

      {actionError && (
        <p className="text-body-sm text-traffic-red">{actionError}</p>
      )}
      {data.cluster.discoveryError && (
        <Card className="border-traffic-yellow/40 p-4">
          <p className="text-body-sm text-traffic-yellow">
            The last inventory scan failed, so this list may be out of date.
          </p>
          <p className="mt-1 font-mono text-[12px] text-bone-gray">
            {data.cluster.discoveryError}
          </p>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-body font-medium text-warm-off-white">
          Monitoring jobs
        </h2>
        <DataTable
          columns={jobColumns}
          rows={data.jobs}
          getKey={(j) => j.id}
          empty="No jobs yet — create one to start assessing workloads."
        />
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-body font-medium text-warm-off-white">
            Discovered workloads
          </h2>
          <Badge variant="outline" className="text-bone-gray">
            {data.workloads.length}
          </Badge>
        </div>
        <DataTable
          columns={workloadColumns}
          rows={data.workloads}
          getKey={(w) => `${w.kind}/${w.namespace}/${w.name}`}
          empty="Nothing discovered. Check the kubeconfig's permissions and rescan."
        />
      </section>

      <section className="space-y-2 border-t border-border pt-6">
        <h2 className="text-body font-medium text-warm-off-white">
          Remove cluster
        </h2>
        <p className="max-w-[70ch] text-body-sm text-bone-gray">
          Deletes the cluster, its monitoring jobs and every concern recorded
          against them. The cluster itself is untouched.
        </p>
        <Button
          variant="outline"
          className="text-traffic-red"
          onClick={remove}
          disabled={busy !== null}
        >
          {busy === "delete" ? "Deleting…" : "Delete cluster"}
        </Button>
      </section>
    </div>
  );
}
