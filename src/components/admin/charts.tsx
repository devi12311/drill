"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// Warp accents (DESIGN.md). Single-series charts, so identity never rests on
// color alone; gold is the primary data hue, cobalt the secondary.
export const GOLD = "#bd9f65";
export const COBALT = "#6f839f";
const AXIS = "#868684"; // bone-gray
const GRID = "#2f2f2f"; // smoke-charcoal
const SURFACE = "#1e1e1d"; // smoked-onyx

const axisTick = { fill: AXIS, fontSize: 11 };

function TooltipBox({
  active,
  payload,
  label,
  format,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name?: string }>;
  label?: string | number;
  format: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-body-sm">
      <div className="text-bone-gray">{label}</div>
      <div className="font-mono text-warm-off-white">
        {format(payload[0].value)}
      </div>
    </div>
  );
}

/** Single-metric time series (spend OR count — never both on one axis). */
export function TimeSeriesChart({
  data,
  metric,
  color = GOLD,
  format,
  height = 220,
}: {
  data: Array<Record<string, string | number>>;
  metric: string;
  color?: string;
  format: (v: number) => string;
  height?: number;
}) {
  const gradId = `grad-${metric}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="day"
          tick={axisTick}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          minTickGap={24}
        />
        <YAxis
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v) => format(Number(v))}
        />
        <Tooltip
          cursor={{ stroke: AXIS, strokeDasharray: "3 3" }}
          content={<TooltipBox format={format} />}
        />
        <Area
          type="monotone"
          dataKey={metric}
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          dot={false}
          activeDot={{ r: 4, fill: color, stroke: SURFACE, strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Horizontal ranked bars (magnitude across categories), single hue. */
export function HBarChart({
  data,
  labelKey,
  valueKey,
  color = GOLD,
  format,
  height,
}: {
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  color?: string;
  format: (v: number) => string;
  height?: number;
}) {
  const h = height ?? Math.max(120, data.length * 34 + 24);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 56, left: 8, bottom: 4 }}
        barCategoryGap={8}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" hide tickFormatter={(v) => format(Number(v))} />
        <YAxis
          type="category"
          dataKey={labelKey}
          tick={axisTick}
          tickLine={false}
          axisLine={false}
          width={130}
        />
        <Tooltip
          cursor={{ fill: GRID, fillOpacity: 0.4 }}
          content={<TooltipBox format={format} />}
        />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]} maxBarSize={22}>
          {data.map((_, i) => (
            <Cell key={i} fill={color} />
          ))}
          <LabelList
            dataKey={valueKey}
            position="right"
            formatter={(v) => format(Number(v))}
            className="fill-bone-gray"
            fontSize={11}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
