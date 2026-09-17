import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildFeedbackWhere } from "../feedback/_query";
import {
  estimatePoints,
  feedbackWhereSql,
  MAX_POINTS,
  resolveBucket,
  spanInDays,
} from "../insights/_volume";
import type { Bucket } from "../insights/_query";
import { toInsightsQuery, type ThemeQuery } from "./_query";

/**
 * Theme counts, theme volume over time, and which themes are spiking.
 *
 * Shared by `GET /api/themes`, `GET /api/themes/trends` and the trends server
 * page, in the same way the inbox shares `feedback/_query.ts` with its route.
 * Every number is produced by Postgres with `COUNT ... FILTER`, `AVG` and
 * `date_trunc`; Node never loads feedback rows to reduce them. The only work
 * done here is filling the empty buckets, which is what the dashboard's volume
 * chart does too, so a quiet week reads as a trough rather than as a straight
 * line drawn between the weeks either side of it.
 *
 * Everything is scoped to one workspace. The theme list is read from `Theme`
 * filtered by workspaceId, and every count joins through feedback that is
 * already scoped, so no join can reach another tenant's rows.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lines on one chart. More than this and the chart is a plate of spaghetti. */
const CHARTED_THEMES = 6;

/**
 * What counts as a spike.
 *
 * Deliberately conservative. Two items becoming four is a doubling and means
 * nothing, so a theme has to clear an absolute floor as well as a ratio before
 * the page tells anybody to look at it.
 */
const SPIKE_MIN_ITEMS = 5;
const SPIKE_MIN_CHANGE = 3;
const SPIKE_RATIO = 1.5;

/** A naive timestamp literal, which is what the `createdAt` column holds. */
function stamp(date: Date): string {
  return date.toISOString().slice(0, 23);
}

export type ThemeTrend = {
  id: string;
  name: string;
  color: string;
  /** Items carrying this theme in the selected slice. */
  total: number;
  /** Share of the items in the slice that carry at least one theme. Null while none do. */
  share: number | null;
  /** Items in the comparison window, and in the window before it. */
  current: number;
  previous: number;
  change: number;
  /** Null when the previous window was empty: growth from nothing has no ratio. */
  changeRatio: number | null;
  spiking: boolean;
  /** Nothing at all last window, a real presence this one. */
  emerging: boolean;
  /**
   * How sure the classifier was, averaged over the links in the slice. A theme
   * held together by 0.4s is worth looking at differently from one full of 0.9s.
   */
  averageConfidence: number | null;
  lastSeen: string | null;
};

export type TrendPoint = {
  bucketStart: string;
  label: string;
  fullLabel: string;
  /** Count per theme id. Themes with nothing in the bucket are present as zero. */
  counts: Record<string, number>;
};

export type TrendSeries = {
  bucket: Bucket;
  points: TrendPoint[];
  /** The themes plotted, in the order the chart should stack its legend. */
  themeIds: string[];
  truncated: boolean;
  clamped: boolean;
};

export type ThemeCoverage = {
  total: number;
  classified: number;
  unclassified: number;
  /** Items carrying at least one theme. An item can carry several. */
  tagged: number;
  themeCount: number;
};

export type TrendWindow = {
  days: number;
  currentFrom: string;
  previousFrom: string;
  /**
   * False when the selected date range ends before the window began, in which
   * case both counts are legitimately zero and no comparison is possible.
   */
  rangeCoversWindow: boolean;
};

export type ThemeTrends = {
  themes: ThemeTrend[];
  /** Null when the caller did not ask for a series, or when the slice is empty. */
  series: TrendSeries | null;
  coverage: ThemeCoverage;
  window: TrendWindow;
  range: { from: string | null; to: string | null };
  generatedAt: string;
};

type CountRow = {
  id: string;
  name: string;
  color: string;
  total: number;
  current: number;
  previous: number;
  averageConfidence: number | null;
  lastSeen: Date | null;
};

type SeriesRow = { themeId: string; bucketStart: Date; count: number };

const SHORT_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const LONG_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const MONTH = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function labelsFor(start: Date, bucket: Bucket): { label: string; fullLabel: string } {
  if (bucket === "month") {
    const text = MONTH.format(start);
    return { label: text, fullLabel: text };
  }
  if (bucket === "week") {
    return { label: SHORT_DAY.format(start), fullLabel: `Week of ${LONG_DAY.format(start)}` };
  }
  return { label: SHORT_DAY.format(start), fullLabel: LONG_DAY.format(start) };
}

/** Postgres `date_trunc` semantics, reproduced in UTC so gap filling lines up. */
function truncate(date: Date, bucket: Bucket): Date {
  const midnight = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  if (bucket === "month") {
    return new Date(Date.UTC(midnight.getUTCFullYear(), midnight.getUTCMonth(), 1));
  }
  if (bucket === "week") {
    // date_trunc('week', ...) starts the week on Monday.
    const weekday = (midnight.getUTCDay() + 6) % 7;
    return new Date(midnight.getTime() - weekday * DAY_MS);
  }
  return midnight;
}

function advance(date: Date, bucket: Bucket): Date {
  if (bucket === "month") {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  }
  return new Date(date.getTime() + (bucket === "week" ? 7 : 1) * DAY_MS);
}

/**
 * One row per theme, with the whole comparison done in the database.
 *
 * The join to feedback is a LEFT JOIN so a theme with nothing attached still
 * appears, at zero, rather than vanishing from the list. `COUNT(f."id")` rather
 * than `COUNT(*)` is what keeps that zero honest: the outer join manufactures a
 * row, and counting the joined id ignores it.
 */
async function loadCounts(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  query: ThemeQuery,
  currentFrom: Date,
  previousFrom: Date,
): Promise<CountRow[]> {
  const where = feedbackWhereSql(workspaceId, toInsightsQuery(query));

  return tx.$queryRaw<CountRow[]>`
    SELECT t."id"    AS "id",
           t."name"  AS "name",
           t."color" AS "color",
           COUNT(f."id")::int AS "total",
           COUNT(f."id") FILTER (
             WHERE f."createdAt" >= ${stamp(currentFrom)}::timestamp
           )::int AS "current",
           COUNT(f."id") FILTER (
             WHERE f."createdAt" >= ${stamp(previousFrom)}::timestamp
               AND f."createdAt" <  ${stamp(currentFrom)}::timestamp
           )::int AS "previous",
           AVG(ft."confidence") FILTER (WHERE f."id" IS NOT NULL)::float8
             AS "averageConfidence",
           MAX(f."createdAt") AS "lastSeen"
    FROM "Theme" t
    LEFT JOIN "FeedbackTheme" ft ON ft."themeId" = t."id"
    LEFT JOIN "Feedback" f ON f."id" = ft."feedbackId" AND ${where}
    WHERE t."workspaceId" = ${workspaceId}
    GROUP BY t."id", t."name", t."color"
    ORDER BY "total" DESC, t."name" ASC
  `;
}

/** Counts per theme per bucket. One row per bucket that actually holds items. */
async function loadSeriesRows(
  workspaceId: string,
  query: ThemeQuery,
  themeIds: string[],
  bucket: Bucket,
  start: Date,
  end: Date,
): Promise<SeriesRow[]> {
  const where = feedbackWhereSql(workspaceId, toInsightsQuery(query));

  return prisma.$queryRaw<SeriesRow[]>`
    SELECT ft."themeId" AS "themeId",
           date_trunc(${bucket}::text, f."createdAt") AS "bucketStart",
           COUNT(*)::int AS "count"
    FROM "FeedbackTheme" ft
    JOIN "Feedback" f ON f."id" = ft."feedbackId"
    WHERE ${where}
      AND ft."themeId" IN (${Prisma.join(themeIds)})
      AND f."createdAt" >= ${stamp(start)}::timestamp
      AND f."createdAt" <= ${stamp(end)}::timestamp
    GROUP BY 1, 2
    ORDER BY 2 ASC
  `;
}

function fillSeries(
  rows: SeriesRow[],
  themeIds: string[],
  bucket: Bucket,
  start: Date,
  end: Date,
  clamped: boolean,
): TrendSeries {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(`${truncate(row.bucketStart, bucket).getTime()}:${row.themeId}`, row.count);
  }

  const points: TrendPoint[] = [];
  const last = truncate(end, bucket);
  let cursor = truncate(start, bucket);
  let truncated = false;

  while (cursor.getTime() <= last.getTime()) {
    if (points.length >= MAX_POINTS) {
      truncated = true;
      break;
    }

    const bucketCounts: Record<string, number> = {};
    for (const themeId of themeIds) {
      bucketCounts[themeId] = counts.get(`${cursor.getTime()}:${themeId}`) ?? 0;
    }

    points.push({
      bucketStart: cursor.toISOString(),
      ...labelsFor(cursor, bucket),
      counts: bucketCounts,
    });

    cursor = advance(cursor, bucket);
  }

  return { bucket, points, themeIds, truncated, clamped };
}

function isSpiking(current: number, previous: number): boolean {
  if (current < SPIKE_MIN_ITEMS) return false;
  if (current - previous < SPIKE_MIN_CHANGE) return false;
  return previous === 0 || current / previous >= SPIKE_RATIO;
}

/**
 * Picks the lines worth drawing: everything flagged as spiking, because that is
 * what the reader came for, then the largest themes until the chart is full.
 */
function chartedThemes(themes: ThemeTrend[]): string[] {
  const chosen = themes.filter((theme) => theme.spiking && theme.total > 0);
  for (const theme of themes) {
    if (chosen.length >= CHARTED_THEMES) break;
    if (theme.total > 0 && !chosen.includes(theme)) chosen.push(theme);
  }
  return chosen.slice(0, CHARTED_THEMES).map((theme) => theme.id);
}

export async function loadThemeTrends(
  workspaceId: string,
  query: ThemeQuery,
  options: { series?: boolean } = {},
): Promise<ThemeTrends> {
  const where = buildFeedbackWhere(workspaceId, {
    page: 1,
    perPage: 1,
    q: query.q,
    channel: query.channel,
    sentiment: query.sentiment,
    themeId: query.themeId,
    status: query.status,
    from: query.from,
    to: query.to,
  });

  const now = new Date();
  const currentFrom = new Date(now.getTime() - query.window * DAY_MS);
  const previousFrom = new Date(now.getTime() - 2 * query.window * DAY_MS);

  // One transaction, so the counts, the coverage and the series all describe the
  // same instant. A theme total of 40 beside "0 items classified" would be worse
  // than either number on its own.
  const [rows, total, classified, tagged, themeCount, bounds] = await prisma.$transaction(
    (tx) =>
      Promise.all([
        loadCounts(tx, workspaceId, query, currentFrom, previousFrom),
        tx.feedback.count({ where }),
        tx.feedback.count({ where: { AND: [where, { classifiedAt: { not: null } }] } }),
        tx.feedback.count({ where: { AND: [where, { themes: { some: {} } }] } }),
        tx.theme.count({ where: { workspaceId } }),
        tx.feedback.aggregate({
          where: { AND: [where, { themes: { some: {} } }] },
          _min: { createdAt: true },
          _max: { createdAt: true },
        }),
      ]),
  );

  const themes: ThemeTrend[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    total: row.total,
    share: tagged > 0 ? row.total / tagged : null,
    current: row.current,
    previous: row.previous,
    change: row.current - row.previous,
    changeRatio: row.previous > 0 ? row.current / row.previous : null,
    spiking: isSpiking(row.current, row.previous),
    emerging: row.previous === 0 && row.current >= SPIKE_MIN_ITEMS,
    averageConfidence: row.averageConfidence,
    lastSeen: row.lastSeen?.toISOString() ?? null,
  }));

  const rangeEnd = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;

  const coverage: ThemeCoverage = {
    total,
    classified,
    unclassified: total - classified,
    tagged,
    themeCount,
  };

  const base: ThemeTrends = {
    themes,
    series: null,
    coverage,
    window: {
      days: query.window,
      currentFrom: currentFrom.toISOString(),
      previousFrom: previousFrom.toISOString(),
      rangeCoversWindow: rangeEnd === null || rangeEnd.getTime() >= currentFrom.getTime(),
    },
    range: { from: null, to: null },
    generatedAt: now.toISOString(),
  };

  if (options.series !== true) return base;

  const ids = chartedThemes(themes);
  if (ids.length === 0 || tagged === 0) return base;

  // The axis is the selected range where there is one, so a filter that happens
  // to exclude the last month still shows that month as a run of zeroes rather
  // than quietly cropping it. A range too wide to plot pulls back to the period
  // that actually holds tagged feedback.
  let from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : bounds._min.createdAt;
  let to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : bounds._max.createdAt;
  if (!from || !to) return base;

  let bucket = resolveBucket(query.bucket, spanInDays(from, to));
  let clamped = false;

  if (
    estimatePoints(from, to, bucket) > MAX_POINTS &&
    bounds._min.createdAt &&
    bounds._max.createdAt
  ) {
    from = bounds._min.createdAt;
    to = bounds._max.createdAt;
    bucket = resolveBucket(query.bucket, spanInDays(from, to));
    clamped = true;
  }

  const seriesRows = await loadSeriesRows(workspaceId, query, ids, bucket, from, to);

  return {
    ...base,
    series: fillSeries(seriesRows, ids, bucket, from, to, clamped),
    range: { from: from.toISOString(), to: to.toISOString() },
  };
}
