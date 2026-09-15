"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EmptyState } from "@/components/ui/states";
import type { ThemeBreakdown } from "@/app/api/insights/_aggregate";
import { TooltipBox } from "./chrome";
import { CHART_AXIS, CHART_GRID, CHART_INK, CHART_MUTED, formatCount, formatPercent, SERIES } from "./theme";

/**
 * Top themes.
 *
 * Comparing magnitude across categories that have no natural order, so: bars,
 * all in one colour. Colouring each bar by its own value would double-encode the
 * length, and giving every theme its own hue would spend the identity channel on
 * something the axis labels already say.
 *
 * Horizontal, because theme names are phrases. A column chart would either
 * truncate "Support & documentation" or tilt it forty-five degrees.
 *
 * Nothing is linked to a theme yet, so today this renders its empty state. The
 * query behind it is already counting the join, so it fills in on its own.
 */

const BAR_THICKNESS = 18;
const ROW_HEIGHT = 34;
const AXIS_BAND = 44;
const NAME_COLUMN = 168;

type Row = {
  id: string;
  name: string;
  count: number;
  countLabel: string;
  shareLabel: string | null;
};

export function ThemesChart({ breakdown }: { breakdown: ThemeBreakdown }) {
  if (breakdown.taggedItems === 0) {
    return (
      <EmptyState
        title="No items are tagged with a theme yet"
        description={
          breakdown.themeCount === 0
            ? "This workspace has no themes defined, so there is nothing to count against."
            : `${breakdown.themeCount} themes are set up and waiting. No feedback has been linked to one yet, so every count here would be zero. This chart fills in on its own once items are classified.`
        }
      />
    );
  }

  const rows: Row[] = breakdown.items.map((item) => ({
    id: item.id,
    name: item.name,
    count: item.count,
    countLabel: formatCount(item.count),
    shareLabel: item.share === null ? null : formatPercent(item.share),
  }));

  const byName = new Map(rows.map((row) => [row.name, row]));
  const height = rows.length * ROW_HEIGHT + AXIS_BAND;

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          accessibilityLayer
          layout="vertical"
          data={rows}
          margin={{ top: 4, right: 40, bottom: 4, left: 0 }}
        >
          <CartesianGrid horizontal={false} stroke={CHART_GRID} strokeWidth={1} />

          <XAxis
            type="number"
            allowDecimals={false}
            tickLine={false}
            axisLine={{ stroke: CHART_AXIS }}
            tick={{ fill: CHART_MUTED, fontSize: 12 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            width={NAME_COLUMN}
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART_INK, fontSize: 12 }}
          />

          <Tooltip
            cursor={{ fill: "#0b0b0b", fillOpacity: 0.04 }}
            content={(props) => {
              const row = typeof props.label === "string" ? byName.get(props.label) : undefined;
              if (!props.active || !row) return null;

              return (
                <TooltipBox
                  title={row.name}
                  rows={[
                    {
                      key: "count",
                      color: SERIES,
                      value: row.shareLabel
                        ? `${row.countLabel} (${row.shareLabel})`
                        : row.countLabel,
                      label: row.count === 1 ? "item" : "items",
                    },
                  ]}
                />
              );
            }}
          />

          <Bar
            dataKey="count"
            name="Items"
            fill={SERIES}
            barSize={BAR_THICKNESS}
            // Rounded at the data end, square where it meets the baseline.
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          >
            {/* The value rides outside the bar tip, so it can never be clipped by
                a bar too short to hold it. */}
            <LabelList
              dataKey="countLabel"
              position="right"
              fill={CHART_INK}
              fontSize={12}
              offset={8}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {breakdown.themeCount > rows.length ? (
        <p className="mt-3 text-sm text-slate-500">
          {`Showing the top ${rows.length} of ${breakdown.themeCount} themes.`}
        </p>
      ) : null}
    </div>
  );
}
