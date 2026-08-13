"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/admin/kpi-card";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { COBALT, GOLD, HBarChart, TimeSeriesChart } from "@/components/admin/charts";
import { useAdminData } from "@/lib/admin/use-admin-data";
import {
  formatDuration,
  formatNumber,
  formatTokens,
  formatUsd,
} from "@/lib/admin/format";

interface OverviewData {
  kpis: {
    spend: number;
    investigations: number;
    tokens: number;
    avgDurationMs: number;
    erroredInvestigations: number;
    activeUsers: number;
    totalUsers: number;
  };
  spendOverTime: { day: string; spend: number; investigations: number }[];
  costByModel: { model: string; spend: number }[];
  topUsers: { userId: string; username: string; spend: number }[];
}

export default function AdminOverviewPage() {
  const [range, setRange] = useState<Range>("30d");
  const { data, loading, error } = useAdminData<OverviewData>(
    `/api/admin/overview?range=${range}`,
    [range],
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Overview"
        description="Spend, throughput and reliability across every user."
      >
        <RangePicker value={range} onChange={setRange} />
      </AdminPageHeader>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiCard label="Total spend" value={formatUsd(data.kpis.spend)} accent />
            <KpiCard
              label="Investigations"
              value={formatNumber(data.kpis.investigations)}
              hint={`${data.kpis.erroredInvestigations} with tool errors`}
            />
            <KpiCard
              label="Avg cost / run"
              value={formatUsd(
                data.kpis.investigations
                  ? data.kpis.spend / data.kpis.investigations
                  : 0,
                3,
              )}
            />
            <KpiCard
              label="Active users"
              value={formatNumber(data.kpis.activeUsers)}
              hint={`of ${data.kpis.totalUsers} total`}
            />
            <KpiCard label="Tokens" value={formatTokens(data.kpis.tokens)} />
            <KpiCard
              label="Avg duration"
              value={formatDuration(data.kpis.avgDurationMs)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
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
            <Card>
              <CardHeader>
                <CardTitle>Investigations over time</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeSeriesChart
                  data={data.spendOverTime}
                  metric="investigations"
                  color={COBALT}
                  format={formatNumber}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Spend by model</CardTitle>
              </CardHeader>
              <CardContent>
                {data.costByModel.length === 0 ? (
                  <p className="py-8 text-body-sm text-bone-gray">No data.</p>
                ) : (
                  <HBarChart
                    data={data.costByModel}
                    labelKey="model"
                    valueKey="spend"
                    color={GOLD}
                    format={(v) => formatUsd(v)}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top users by spend</CardTitle>
              </CardHeader>
              <CardContent>
                {data.topUsers.length === 0 ? (
                  <p className="py-8 text-body-sm text-bone-gray">No data.</p>
                ) : (
                  <HBarChart
                    data={data.topUsers}
                    labelKey="username"
                    valueKey="spend"
                    color={COBALT}
                    format={(v) => formatUsd(v)}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
