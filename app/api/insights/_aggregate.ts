import { Prisma, Sentiment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildFeedbackWhere } from "../feedback/_query";
import { toFeedbackQuery, type InsightsQuery } from "./_query";
import {
  estimatePoints,
  loadVolume,
  MAX_POINTS,
  resolveBucket,
  spanInDays,
  type VolumeSeries,
} from "./_volume";

/**
 * Everything the dashboard shows, in one workspace-scoped read.
 *
 * Shared by `GET /api/insights` and the dashboard server page, exactly as the
 * inbox shares `_query.ts` with its route. Every count is produced by the
 * database with `count`, `groupBy` or `date_trunc`; nothing here loads feedback
 * rows to reduce them in Node.
 *
 * Classification has not shipped yet, so sentiment and theme counts are legitimately
 * zero today. Nothing below substitutes a placeholder for that. The shapes carry
 * enough context for the UI to say "not classified yet" rather than "none", and
 * the same queries will fill in on their own once the pipeline starts writing.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many themes the chart shows before the tail is folded away. */
const TOP_THEMES = 8;

/** Worst to best, so the diverging sentiment bar reads left to right in order. */
const SENTIMENT_ORDER: Sentiment[] = [Sentiment.NEG, Sentiment.NEU, Sentiment.POS];

/**
 * Adds a condition without disturbing the ones already there. The inbox's search
 * puts an array in `AND`, and `from`/`to` put a filter on `createdAt`, so neither
 * may be overwritten by a spread.
 */
function and(
  where: Prisma.FeedbackWhereInput,
  extra: Prisma.FeedbackWhereInput,
): Prisma.FeedbackWhereInput {
  const existing = where.AND;
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  return { ...where, AND: [...list, extra] };
}

export type SentimentSlice = {
  key: Sentiment;
  count: number;
  /** Share of the classified items. Null while nothing in the slice is classified. */
  share: number | null;
};

export type SentimentBreakdown = {
  slices: SentimentSlice[];
  classified: number;
  unclassified: number;
  total: number;
};

export type ThemeCount = {
  id: string;
  name: string;
  color: string;
  count: number;
  /** Share of the items carrying at least one theme. Null while none are tagged. */
  share: number | null;
};

export type ThemeBreakdown = {
  items: ThemeCount[];
  /** How many themes the workspace has defined, which may exceed what is charted. */
  themeCount: number;
  /** Items in the slice carrying at least one theme. Items can carry several. */
  taggedItems: number;
};

export type DashboardStats = {
  total: number;
  classified: number;
  unclassified: number;
  negative: number;
  /**
   * Negative as a share of the classified items, not of everything. Null when
   * nothing in the slice is classified: with an empty denominator there is no
   * percentage, and printing 0% would read as "no negative feedback".
   */
  negativeShare: number | null;
  newThisWeek: number;
  /** The seven days before that, so the week can be shown as a change. */
  previousWeek: number;
  weekFrom: string;
  /** False when the selected date range ends before the last seven days began. */
  rangeCoversThisWeek: boolean;
};

export type DashboardInsights = {
  stats: DashboardStats;
  volume: VolumeSeries;
  sentiment: SentimentBreakdown;
  themes: ThemeBreakdown;
  /** The time axis actually plotted, ISO. Null on both ends when the slice is empty. */
  range: { from: string | null; to: string | null };
  generatedAt: string;
};

type Bounds = { _min: { createdAt: Date | null }; _max: { createdAt: Date | null } };

/**
 * Picks the time axis, then groups against it.
 *
 * The axis is the selected date range where there is one, so a filter that
 * happens to exclude the last month still shows that month as a run of zeroes
 * rather than quietly cropping it. The exception is a range so wide it cannot be
 * plotted at all, such as a hand-typed year 1900: there the axis pulls back to
 * the period that actually holds feedback, because a chart summing to zero
 * beside a stat card reading 127 is worse than a narrower chart.
 */
async function loadVolumeSeries(
  workspaceId: string,
  query: InsightsQuery,
  total: number,
  bounds: Bounds,
): Promise<{ series: VolumeSeries; from: Date | null; to: Date | null }> {
  const dataFrom = bounds._min.createdAt;
  const dataTo = bounds._max.createdAt;

  let from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : dataFrom;
  let to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : dataTo;

  // Nothing in the slice means no axis to draw, and no reason to run the query.
  if (total === 0 || !from || !to) {
    return {
      series: {
        bucket: resolveBucket(query.bucket, 0),
        points: [],
        total: 0,
        truncated: false,
        clamped: false,
      },
      from: null,
      to: null,
    };
  }

  let bucket = resolveBucket(query.bucket, spanInDays(from, to));
  let clamped = false;

  if (estimatePoints(from, to, bucket) > MAX_POINTS && dataFrom && dataTo) {
    from = dataFrom;
    to = dataTo;
    bucket = resolveBucket(query.bucket, spanInDays(from, to));
    clamped = true;
  }

  return {
    series: await loadVolume(workspaceId, query, bucket, from, to, clamped),
    from,
    to,
  };
}

export async function loadInsights(
  workspaceId: string,
  query: InsightsQuery,
): Promise<DashboardInsights> {
  const where = buildFeedbackWhere(workspaceId, toFeedbackQuery(query));

  const now = new Date();
  const weekFrom = new Date(now.getTime() - 7 * DAY_MS);
  const previousFrom = new Date(now.getTime() - 14 * DAY_MS);

  // One transaction, so every tile and chart describes the same instant. A total
  // of 127 beside "0 of 130 classified" would be worse than either number alone.
  const [total, bounds, sentimentRows, themeRows, themes, taggedItems, newThisWeek, previousWeek] =
    await prisma.$transaction((tx) =>
      Promise.all([
        tx.feedback.count({ where }),
        tx.feedback.aggregate({
          where,
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
        tx.feedback.groupBy({
          by: ["sentiment"],
          where,
          _count: { _all: true },
          orderBy: { sentiment: "asc" },
        }),
        // The relation filter reaches feedback that is already workspace-scoped, so a
        // link cannot pull in a count from another tenant.
        tx.feedbackTheme.groupBy({
          by: ["themeId"],
          where: { feedback: { is: where } },
          _count: { _all: true },
          orderBy: { themeId: "asc" },
        }),
        tx.theme.findMany({
          where: { workspaceId },
          select: { id: true, name: true, color: true },
          orderBy: { name: "asc" },
        }),
        tx.feedback.count({ where: and(where, { themes: { some: {} } }) }),
        tx.feedback.count({ where: and(where, { createdAt: { gte: weekFrom } }) }),
        tx.feedback.count({
          where: and(where, { createdAt: { gte: previousFrom, lt: weekFrom } }),
        }),
      ]),
    );

  const sentimentCounts = new Map<Sentiment | null, number>();
  for (const row of sentimentRows) sentimentCounts.set(row.sentiment, row._count._all);

  const unclassified = sentimentCounts.get(null) ?? 0;
  const classified = total - unclassified;
  const negative = sentimentCounts.get(Sentiment.NEG) ?? 0;

  const slices: SentimentSlice[] = SENTIMENT_ORDER.map((key) => {
    const count = sentimentCounts.get(key) ?? 0;
    return { key, count, share: classified > 0 ? count / classified : null };
  });

  // Joining through the workspace's own themes, rather than trusting the grouped
  // rows, means only this tenant's theme names can ever be charted.
  const themeCounts = new Map(themeRows.map((row) => [row.themeId, row._count._all]));
  const themeItems: ThemeCount[] = themes
    .map((theme) => {
      const count = themeCounts.get(theme.id) ?? 0;
      return {
        ...theme,
        count,
        share: taggedItems > 0 ? count / taggedItems : null,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, TOP_THEMES);

  const volume = await loadVolumeSeries(workspaceId, query, total, bounds);

  const rangeEnd = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;

  return {
    stats: {
      total,
      classified,
      unclassified,
      negative,
      negativeShare: classified > 0 ? negative / classified : null,
      newThisWeek,
      previousWeek,
      weekFrom: weekFrom.toISOString(),
      rangeCoversThisWeek: rangeEnd === null || rangeEnd.getTime() >= weekFrom.getTime(),
    },
    volume: volume.series,
    sentiment: { slices, classified, unclassified, total },
    themes: { items: themeItems, themeCount: themes.length, taggedItems },
    range: {
      from: volume.from?.toISOString() ?? null,
      to: volume.to?.toISOString() ?? null,
    },
    generatedAt: now.toISOString(),
  };
}
