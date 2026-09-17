"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/states";
import { ChartLegend, TooltipBox } from "@/components/charts/chrome";
import {
  CHART_AXIS,
  CHART_GRID,
  CHART_MUTED,
  CHART_SURFACE,
  formatCount,
} from "@/components/charts/theme";
import type { ThemeTrend, TrendSeries } from "@/app/api/themes/_trends";

/**
 * Theme volume over time.
 *
 * Several series that each move independently, so lines rather than an area:
 * stacking would turn "billing is growing" into a shape that depends on what
 * the theme below it did. Each line wears its own theme's colour, which is the
 * colour the same theme wears everywhere else in the app, and the legend is
 * always present because there is more than one thing plotted.
 *
 * Buckets with no items arrive as explicit zeroes from the server, so a quiet
 * week reads as a trough rather than as a straight line drawn across it.
 */

/** Roughly this many x-axis ticks, whatever the bucket count, so labels never collide. */
const TARGET_TICKS = 8;

const BUCKET_NOUN = { day: "day", week: "week", month: "month" } as const;

type Row = Record<string, string | number>;

export function ThemeTrendsChart({
  series,
  themes,
}: {
  series: TrendSeries;
  themes: ThemeTrend[];
}) {
  const charted = series.themeIds
    .map((id) => themes.find((theme) => theme.id === id))
    .filter((theme): theme is ThemeTrend => theme !== undefined);

  if (series.points.length === 0 || charted.length === 0) {
    return (
      <EmptyState
        title="Nothing to plot yet"
        description="No themed feedback falls inside the current filters. Widen the date range or clear a filter."
      />
    );
  }

  const byStart = new Map(series.points.map((point) => [point.bucketStart, point]));

  const rows: Row[] = series.points.map((point) => {
    const row: Row = { bucketStart: point.bucketStart };
    for (const theme of charted) row[theme.id] = point.counts[theme.id] ?? 0;
    return row;
  });

  const tickInterval = Math.max(0, Math.ceil(series.points.length / TARGET_TICKS) - 1);
  const noun = BUCKET_NOUN[series.bucket];

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart accessibilityLayer data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={CHART_GRID} strokeWidth={1} />

          <XAxis
            dataKey="bucketStart"
            interval={tickInterval}
            tickFormatter={(value: string) => byStart.get(value)?.label ?? ""}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS }}
            tick={{ fill: CHART_MUTED, fontSize: 12 }}
            minTickGap={8}
          />

          <YAxis
            allowDecimals={false}
            width={40}
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART_MUTED, fontSize: 12 }}
          />

          <Tooltip
            cursor={{ stroke: CHART_AXIS, strokeWidth: 1 }}
            content={(props) => {
              const point = typeof props.label === "string" ? byStart.get(props.label) : undefined;
              if (!props.active || !point) return null;

              // Read from the server's own numbers rather than from the hovered
              // payload, so the tooltip lists every theme in a fixed order and
              // a line sitting at zero is still accounted for.
              const rows = charted
                .map((theme) => ({
                  key: theme.id,
                  label: theme.name,
                  color: theme.color,
                  count: point.counts[theme.id] ?? 0,
                }))
                .filter((row) => row.count > 0)
                .sort((a, b) => b.count - a.count);

              if (rows.length === 0) return null;

              return (
                <TooltipBox
                  title={point.fullLabel}
                  rows={rows.map((row) => ({
                    key: row.key,
                    label: row.label,
                    color: row.color,
                    value: formatCount(row.count),
                  }))}
                />
              );
            }}
          />

          {charted.map((theme) => (
            <Line
              key={theme.id}
              type="linear"
              dataKey={theme.id}
              name={theme.name}
              stroke={theme.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              dot={false}
              // The ring is the surface colour, so the marker stays legible
              // wherever it lands and widens the hover target at the same time.
              activeDot={{ r: 4, fill: theme.color, stroke: CHART_SURFACE, strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <ChartLegend
        items={charted.map((theme) => ({
          key: theme.id,
          label: theme.name,
          color: theme.color,
          value: formatCount(theme.total),
        }))}
      />

      <p className="sr-only">
        {`Theme volume by ${noun}, ${series.points.length} ${noun === "day" ? "days" : `${noun}s`} from ${series.points[0].fullLabel} to ${series.points[series.points.length - 1].fullLabel}, covering ${charted.map((theme) => `${theme.name} with ${theme.total} items`).join(", ")}.`}
      </p>
    </div>
  );
}
