"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/states";
import type { VolumeSeries } from "@/app/api/insights/_volume";
import { TooltipBox } from "./chrome";
import { CHART_AXIS, CHART_GRID, CHART_INK, CHART_MUTED, CHART_SURFACE, SERIES } from "./theme";

/**
 * Feedback volume over time.
 *
 * Trend over time with a single series, so it is an area: one hue, a 2px line,
 * and the fill kept to a wash rather than a saturated block. No legend, because
 * there is only one thing plotted and the card title names it.
 *
 * Buckets with no feedback arrive as explicit zeroes from the server, so a quiet
 * week reads as a trough rather than as a straight line drawn between the days
 * either side of it.
 */

/** Roughly this many x-axis ticks, whatever the bucket count, so labels never collide. */
const TARGET_TICKS = 8;

const BUCKET_NOUN = { day: "day", week: "week", month: "month" } as const;

export function VolumeChart({ series }: { series: VolumeSeries }) {
  if (series.points.length === 0) {
    return (
      <EmptyState
        title="No feedback in this slice"
        description="Nothing has come in that matches the current filters. Widen the date range or clear a filter to see the trend."
      />
    );
  }

  const byStart = new Map(series.points.map((point) => [point.bucketStart, point]));
  const counts = series.points.map((point) => point.count);
  const highest = Math.max(...counts);

  // Label the extreme, not every point. A value beside all eighty-five of them
  // would be unreadable. The label is dropped when several buckets tie for the
  // highest, because marking one of them would imply it stood alone.
  const peak =
    counts.filter((count) => count === highest).length === 1 && highest > 0
      ? series.points.find((point) => point.count === highest)
      : undefined;

  const tickInterval = Math.max(0, Math.ceil(series.points.length / TARGET_TICKS) - 1);
  const noun = BUCKET_NOUN[series.bucket];

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          accessibilityLayer
          data={series.points}
          margin={{ top: 24, right: 16, bottom: 4, left: 0 }}
        >
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
              const point =
                typeof props.label === "string" ? byStart.get(props.label) : undefined;
              if (!props.active || !point) return null;

              return (
                <TooltipBox
                  title={point.fullLabel}
                  rows={[
                    {
                      key: "count",
                      color: SERIES,
                      value: String(point.count),
                      label: point.count === 1 ? "item" : "items",
                    },
                  ]}
                />
              );
            }}
          />

          <Area
            type="linear"
            dataKey="count"
            name="Feedback items"
            stroke={SERIES}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill={SERIES}
            fillOpacity={0.1}
            dot={false}
            // The ring is the surface colour, so the marker stays legible wherever
            // it lands on the line, and it widens the hover target at the same time.
            activeDot={{ r: 4, fill: SERIES, stroke: CHART_SURFACE, strokeWidth: 2 }}
          />

          {peak ? (
            <ReferenceDot
              x={peak.bucketStart}
              y={peak.count}
              r={4}
              fill={SERIES}
              stroke={CHART_SURFACE}
              strokeWidth={2}
              label={{
                value: `${peak.count} on ${peak.label}`,
                position: "top",
                fill: CHART_INK,
                fontSize: 12,
              }}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>

      <p className="sr-only">
        {`Feedback volume by ${noun}, ${series.points.length} ${noun === "day" ? "days" : `${noun}s`} from ${series.points[0].fullLabel} to ${series.points[series.points.length - 1].fullLabel}, ${series.total} items in total.`}
      </p>
    </div>
  );
}
