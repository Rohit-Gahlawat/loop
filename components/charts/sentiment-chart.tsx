"use client";

import {
  Bar,
  BarChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";
import { EmptyState } from "@/components/ui/states";
import { SENTIMENT_LABELS } from "@/components/inbox/tags";
import type { SentimentBreakdown } from "@/app/api/insights/_aggregate";
import { ChartLegend, TooltipBox, type LegendItem } from "./chrome";
import { CHART_AXIS, CHART_MUTED, formatCount, formatPercent, SENTIMENT_COLORS } from "./theme";

/**
 * Sentiment breakdown.
 *
 * Sentiment is an ordered scale rather than a set of names, so this is a
 * diverging stacked bar centred on neutral: negative runs left, positive runs
 * right, and neutral straddles the middle in half. Centring on neutral is what
 * makes two slices comparable at a glance, which a left-to-right stack does not.
 *
 * Nothing is classified yet, so today this renders its empty state. When the
 * pipeline starts writing sentiment the same query fills it in.
 */

/** Thin marks. A bar never fills its band; the leftover is air. */
const BAR_THICKNESS = 24;

/** White doing the separating. Each side of a boundary gives up half of it. */
const GAP = 2;

const CORNER_RADIUS = 4;

type Side = "left" | "right" | "none";

function arc(radius: number, x: number, y: number): string {
  return radius > 0 ? `A ${radius} ${radius} 0 0 1 ${x} ${y}` : `L ${x} ${y}`;
}

/**
 * A rectangle rounded on the side that is a data end and square where it meets
 * the baseline, inset on whichever sides touch a neighbouring segment. The inset
 * is how the gap is made: a border drawn around the mark would add ink that is
 * not data.
 */
function segment(round: Side, insetLeft: number, insetRight: number) {
  return function Segment(props: BarShapeProps) {
    const rawX = Number(props.x ?? 0);
    const rawWidth = Number(props.width ?? 0);
    const y = Number(props.y ?? 0);
    const height = Number(props.height ?? 0);

    // Recharts can hand back a negative width for a bar that grows leftwards.
    const left = Math.min(rawX, rawX + rawWidth) + insetLeft;
    const width = Math.abs(rawWidth) - insetLeft - insetRight;

    if (width <= 0 || height <= 0) return null;

    const radius = Math.min(CORNER_RADIUS, height / 2, width);
    const rl = round === "left" ? radius : 0;
    const rr = round === "right" ? radius : 0;
    const right = left + width;
    const bottom = y + height;

    const path = [
      `M ${left + rl} ${y}`,
      `L ${right - rr} ${y}`,
      arc(rr, right, y + rr),
      `L ${right} ${bottom - rr}`,
      arc(rr, right - rr, bottom),
      `L ${left + rl} ${bottom}`,
      arc(rl, left, bottom - rl),
      `L ${left} ${y + rl}`,
      arc(rl, left + rl, y),
      "Z",
    ].join(" ");

    return <path d={path} fill={props.fill} />;
  };
}

export function SentimentChart({ breakdown }: { breakdown: SentimentBreakdown }) {
  const counts = new Map(breakdown.slices.map((slice) => [slice.key, slice.count]));
  const negative = counts.get("NEG") ?? 0;
  const neutral = counts.get("NEU") ?? 0;
  const positive = counts.get("POS") ?? 0;

  if (breakdown.classified === 0) {
    return (
      <EmptyState
        title="Nothing has been classified yet"
        description={
          breakdown.total === 0
            ? "There is no feedback in this slice to classify. Widen the date range or clear a filter."
            : `All ${formatCount(breakdown.total)} items in this slice are still waiting on classification, so there is no sentiment to break down. This chart fills in on its own once they are classified.`
        }
      />
    );
  }

  const legend: LegendItem[] = breakdown.slices.map((slice) => ({
    key: slice.key,
    label: SENTIMENT_LABELS[slice.key],
    color: SENTIMENT_COLORS[slice.key],
    value:
      slice.share === null
        ? formatCount(slice.count)
        : `${formatCount(slice.count)} (${formatPercent(slice.share)})`,
  }));

  // Neutral is split across the centre line so the two poles start from the same
  // place and can be compared by length alone.
  const data = [
    {
      name: "All classified feedback",
      negOuter: -negative,
      neuLeft: -neutral / 2,
      neuRight: neutral / 2,
      posOuter: positive,
    },
  ];

  // Ticks are placed by hand rather than left to the chart. An automatic scale
  // picks its own round numbers, which on a symmetric domain lands a tick near
  // but not on the centre, and labelling that "2" instead of "0" would put the
  // dividing line in the wrong place for anyone reading the axis.
  const bound = Math.max(1, Math.ceil(Math.max(negative, positive) + neutral / 2));
  const half = Math.max(1, Math.round(bound / 2));
  const ticks = [-bound, -half, 0, half, bound];

  return (
    <div>
      <ResponsiveContainer width="100%" height={110}>
        <BarChart
          accessibilityLayer
          layout="vertical"
          data={data}
          stackOffset="sign"
          margin={{ top: 8, right: 16, bottom: 0, left: 16 }}
        >
          <XAxis
            type="number"
            domain={[-bound, bound]}
            ticks={ticks}
            allowDecimals={false}
            tickFormatter={(value: number) => formatCount(Math.abs(value))}
            tickLine={false}
            axisLine={false}
            tick={{ fill: CHART_MUTED, fontSize: 12 }}
          />
          <YAxis type="category" dataKey="name" hide />

          <ReferenceLine x={0} stroke={CHART_AXIS} strokeWidth={1} />

          <Tooltip
            cursor={{ fill: "#0b0b0b", fillOpacity: 0.04 }}
            content={(props) =>
              props.active ? (
                <TooltipBox
                  title={`${formatCount(breakdown.classified)} classified items`}
                  rows={breakdown.slices.map((slice) => ({
                    key: slice.key,
                    color: SENTIMENT_COLORS[slice.key],
                    value:
                      slice.share === null
                        ? formatCount(slice.count)
                        : `${formatCount(slice.count)} (${formatPercent(slice.share)})`,
                    label: SENTIMENT_LABELS[slice.key],
                  }))}
                />
              ) : null
            }
          />

          {/* Declaration order decides the stack: the first negative bar sits
              against the centre line and the second stacks outside it. */}
          <Bar
            dataKey="neuLeft"
            stackId="sentiment"
            fill={SENTIMENT_COLORS.NEU}
            barSize={BAR_THICKNESS}
            shape={segment("none", GAP / 2, 0)}
            isAnimationActive={false}
          />
          <Bar
            dataKey="negOuter"
            stackId="sentiment"
            fill={SENTIMENT_COLORS.NEG}
            barSize={BAR_THICKNESS}
            shape={segment("left", 0, GAP / 2)}
            isAnimationActive={false}
          />
          <Bar
            dataKey="neuRight"
            stackId="sentiment"
            fill={SENTIMENT_COLORS.NEU}
            barSize={BAR_THICKNESS}
            shape={segment("none", 0, GAP / 2)}
            isAnimationActive={false}
          />
          <Bar
            dataKey="posOuter"
            stackId="sentiment"
            fill={SENTIMENT_COLORS.POS}
            barSize={BAR_THICKNESS}
            shape={segment("right", GAP / 2, 0)}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>

      <ChartLegend items={legend} />
    </div>
  );
}
