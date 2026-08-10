"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/admin/data-table";
import { AdminPageHeader } from "@/components/admin/page-header";
import { RangePicker, type Range } from "@/components/admin/range-picker";
import { GOLD, HBarChart, TimeSeriesChart } from "@/components/admin/charts";
import { useAdminData } from "@/lib/admin/use-admin-data";
import { formatNumber, formatTokens, formatUsd } from "@/lib/admin/format";

interface CostData {
  spendOverTime: { day: string; spend: number }[];
  costByModel: { model: string; spend: number }[];
  costByUser: {
    userId: string;
    username: string;
    spend: number;
    investigations: number;
    tokens: number;
  }[];
}

function downloadCsv(rows: CostData["costByUser"], range: string) {
  const header = "username,spend_usd,investigations,tokens\n";
  const body = rows
    .map(
      (r) =>
        `${r.username},${r.spend.toFixed(4)},${r.investigations},${r.tokens}`,
    )
    .join("\n");
  const blob = new Blob([header + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `drill-cost-${range}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminCostPage() {
  const [range, setRange] = useState<Range>("30d");
  const { data, loading, error } = useAdminData<CostData>(
    `/api/admin/cost?range=${range}`,
    [range],
  );

  const columns: Column<CostData["costByUser"][number]>[] = [
    { key: "username", header: "User", render: (u) => u.username },
    {
      key: "spend",
      header: "Spend",
      align: "right",
      render: (u) => (
        <span className="font-mono text-warm-off-white">
          {formatUsd(u.spend)}
        </span>
      ),
    },
    {
      key: "investigations",
      header: "Runs",
      align: "right",
      render: (u) => formatNumber(u.investigations),
    },
    {
      key: "tokens",
      header: "Tokens",
      align: "right",
      render: (u) => formatTokens(u.tokens),
    },
  ];

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Cost & usage"
        description="Where the investigation budget goes, by day, model and user."
      >
        <RangePicker value={range} onChange={setRange} />
        <button
          type="button"
          disabled={!data?.costByUser.length}
          onClick={() => data && downloadCsv(data.costByUser, range)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-body-sm text-bone-gray hover:bg-smoke-charcoal hover:text-warm-off-white disabled:opacity-50"
        >
          <Download className="size-4" />
          CSV
        </button>
      </AdminPageHeader>

      {error ? (
        <p className="py-8 text-body-sm text-traffic-red">{error}</p>
      ) : loading || !data ? (
        <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
      ) : (
        <>
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
          </div>

          <div>
            <h3 className="mb-3 text-body text-warm-off-white">Spend by user</h3>
            <DataTable
              columns={columns}
              rows={data.costByUser}
              getKey={(u) => u.userId}
              empty="No spend in this range."
            />
          </div>
        </>
      )}
    </div>
  );
}
