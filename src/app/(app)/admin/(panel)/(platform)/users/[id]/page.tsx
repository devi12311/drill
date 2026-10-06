"use client";

import { use, useState } from "react";
import Link from "next/link";
import { ArrowLeft, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/admin/kpi-card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { GOLD, TimeSeriesChart } from "@/components/admin/charts";
import { DataTable, type Column } from "@/components/admin/data-table";
import { useAdminData } from "@/lib/admin/use-admin-data";
import {
  formatNumber,
  formatRelative,
  formatTokens,
  formatUsd,
} from "@/lib/admin/format";
import { CHAT_HOME } from "@/lib/routes";

interface UserDetailData {
  user: { id: string; username: string; role: "user" | "admin"; createdAt: string };
  totals: { spend: number; investigations: number; tokens: number };
  spendOverTime: { day: string; spend: number }[];
  agents: {
    id: string;
    name: string;
    url: string;
    lastValidatedAt: string | null;
  }[];
  conversations: {
    id: string;
    title: string;
    model: string;
    status: string;
    updatedAt: string;
  }[];
}

export default function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [range, setRange] = useState<Range>("30d");
  const [busy, setBusy] = useState(false);
  const { data, loading, error } = useAdminData<UserDetailData>(
    `/api/admin/users/${id}?range=${range}`,
    [id, range],
  );

  async function impersonate() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      window.location.assign(CHAT_HOME);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to impersonate");
      setBusy(false);
    }
  }

  const agentColumns: Column<UserDetailData["agents"][number]>[] = [
    { key: "name", header: "Agent", render: (a) => a.name },
    {
      key: "url",
      header: "URL",
      render: (a) => (
        <span className="font-mono text-[12px] text-bone-gray">{a.url}</span>
      ),
    },
    {
      key: "lastValidatedAt",
      header: "Last validated",
      align: "right",
      render: (a) => formatRelative(a.lastValidatedAt),
    },
  ];

  const convColumns: Column<UserDetailData["conversations"][number]>[] = [
    { key: "title", header: "Conversation", render: (c) => c.title },
    {
      key: "model",
      header: "Model",
      render: (c) => (
        <span className="font-mono text-[12px] text-muted-cobalt">{c.model}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <Badge variant="outline">{c.status}</Badge>
      ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      align: "right",
      render: (c) => formatRelative(c.updatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/admin/users"
        className="inline-flex items-center gap-2 text-body-sm text-bone-gray hover:text-warm-off-white"
      >
        <ArrowLeft className="size-3.5" />
        Users
      </Link>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <>
          <AdminPageHeader
            title={
              <span className="flex items-center gap-3">
                {data.user.username}
                {data.user.role === "admin" && (
                  <Badge variant="outline" className="text-gold-leaf">
                    admin
                  </Badge>
                )}
              </span>
            }
            description={`Joined ${new Date(
              data.user.createdAt,
            ).toLocaleDateString()}`}
          >
            <RangePicker value={range} onChange={setRange} />
            <button
              type="button"
              onClick={impersonate}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-body-sm text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white disabled:opacity-50"
            >
              <UserCog className="size-4" />
              Impersonate
            </button>
          </AdminPageHeader>

          <div className="grid grid-cols-3 gap-3">
            <KpiCard label="Spend" value={formatUsd(data.totals.spend)} accent />
            <KpiCard
              label="Investigations"
              value={formatNumber(data.totals.investigations)}
            />
            <KpiCard label="Tokens" value={formatTokens(data.totals.tokens)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Spend over time</CardTitle>
            </CardHeader>
            <CardContent>
              <TimeSeriesChart
                data={data.spendOverTime}
                metric="spend"
                color={GOLD}
                format={(v) => formatUsd(v)}
              />
            </CardContent>
          </Card>

          <div>
            <h3 className="mb-3 text-body text-warm-off-white">Agents</h3>
            <DataTable
              columns={agentColumns}
              rows={data.agents}
              getKey={(a) => a.id}
              empty="No agents configured — this user cannot run investigations."
            />
          </div>

          <div>
            <h3 className="mb-3 text-body text-warm-off-white">
              Recent conversations
            </h3>
            <DataTable
              columns={convColumns}
              rows={data.conversations}
              getKey={(c) => c.id}
              empty="No conversations."
            />
          </div>
        </>
      )}
    </div>
  );
}
