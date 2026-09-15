import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UNCLASSIFIED } from "../feedback/_constants";
import type { Bucket, BucketInput, InsightsQuery } from "./_query";

/**
 * Feedback volume over time.
 *
 * Counting rows per day is a grouping job, so it happens in Postgres with
 * `date_trunc` and `GROUP BY`. Node only ever sees one row per bucket, never the
 * feedback itself. The filters are the same ones the inbox applies, rewritten as
 * SQL fragments because `buildFeedbackWhere` produces a Prisma object that
 * `$queryRaw` cannot consume. Every value goes in as a bound parameter.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** A guard against a hand-edited range like from=0001-01-01, which would otherwise fill forever. */
export const MAX_POINTS = 800;

/** Coarse to fine, so a requested bucket can be compared against the automatic one. */
const COARSENESS: Bucket[] = ["day", "week", "month"];

/**
 * At most six terms, each of which must appear somewhere in the content. This
 * mirrors the inbox's search, wildcards included: Prisma's `contains` builds
 * `ILIKE '%' || $1 || '%'` without escaping, so a `%` in the search box behaves
 * as a wildcard on both pages rather than one.
 */
function searchTerms(query: string | undefined): string[] {
  if (!query) return [];
  return query.split(/\s+/).filter(Boolean).slice(0, 6);
}

/**
 * The workspaceId is the first condition and is never taken from client input.
 * A themeId belonging to another workspace simply matches nothing, because the
 * EXISTS subquery can only reach rows already scoped to this workspace.
 *
 * Timestamps are compared against naive literals cast to `timestamp`, which is
 * what the column is. The stored values are UTC, and the inbox's `from`/`to`
 * bounds are UTC midnights, so the two pages select exactly the same rows.
 */
export function feedbackWhereSql(workspaceId: string, query: InsightsQuery): Prisma.Sql {
  const clauses: Prisma.Sql[] = [Prisma.sql`f."workspaceId" = ${workspaceId}`];

  if (query.channel) clauses.push(Prisma.sql`f."channel" = ${query.channel}`);
  if (query.status) clauses.push(Prisma.sql`f."status" = ${query.status}::"FeedbackStatus"`);

  if (query.sentiment) {
    clauses.push(
      query.sentiment === UNCLASSIFIED
        ? Prisma.sql`f."sentiment" IS NULL`
        : Prisma.sql`f."sentiment" = ${query.sentiment}::"Sentiment"`,
    );
  }

  if (query.themeId) {
    clauses.push(
      Prisma.sql`EXISTS (
        SELECT 1 FROM "FeedbackTheme" ft
        WHERE ft."feedbackId" = f."id" AND ft."themeId" = ${query.themeId}
      )`,
    );
  }

  if (query.from) {
    clauses.push(Prisma.sql`f."createdAt" >= ${`${query.from}T00:00:00.000`}::timestamp`);
  }
  // The end of the range is inclusive: "to 2026-09-10" includes that whole day.
  if (query.to) {
    clauses.push(Prisma.sql`f."createdAt" <= ${`${query.to}T23:59:59.999`}::timestamp`);
  }

  for (const term of searchTerms(query.q)) {
    clauses.push(Prisma.sql`f."content" ILIKE ${`%${term}%`}`);
  }

  return Prisma.join(clauses, " AND ");
}

/** Postgres `date_trunc` semantics, reproduced in UTC so gap filling lines up with the rows. */
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
 * A bucket the span can actually carry. A caller may ask for a coarser bucket
 * than the span suggests, but never a finer one: "day" across five years would
 * be two thousand unreadable points.
 */
export function resolveBucket(requested: BucketInput, spanDays: number): Bucket {
  // A quarter of daily points still reads as a shape; a year of them is a smear.
  const automatic: Bucket = spanDays <= 92 ? "day" : spanDays <= 400 ? "week" : "month";
  if (requested === "auto") return automatic;
  return COARSENESS.indexOf(requested) > COARSENESS.indexOf(automatic) ? requested : automatic;
}

export function spanInDays(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

/** How many points an axis would produce, so an unplottable range can be caught early. */
export function estimatePoints(start: Date, end: Date, bucket: Bucket): number {
  const days = spanInDays(start, end);
  if (bucket === "month") {
    return (
      (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      (end.getUTCMonth() - start.getUTCMonth()) +
      1
    );
  }
  return Math.floor(days / (bucket === "week" ? 7 : 1)) + 1;
}

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

/** One point on the time axis. Dates are ISO strings so the shape survives HTTP. */
export type VolumePoint = {
  bucketStart: string;
  label: string;
  fullLabel: string;
  count: number;
};

export type VolumeSeries = {
  bucket: Bucket;
  points: VolumePoint[];
  /** Sum of the points. Equal to the total stat, which is how the two are cross-checked. */
  total: number;
  /** True when the requested range was too wide to plot in full and was cut short. */
  truncated: boolean;
  /**
   * True when the selected range was too wide to plot and the axis was pulled in
   * to the period that actually holds feedback. Saying so keeps the chart from
   * silently disagreeing with the total on the stat card above it.
   */
  clamped: boolean;
};

type VolumeRow = { bucketStart: Date; count: number };

/**
 * Buckets with no feedback come back missing, not as zero. Filling them in keeps
 * the line honest: a quiet fortnight should read as a trough, not as a straight
 * segment drawn between the two days either side of it.
 */
function fill(
  rows: VolumeRow[],
  bucket: Bucket,
  start: Date,
  end: Date,
  clamped: boolean,
): VolumeSeries {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(truncate(row.bucketStart, bucket).getTime(), row.count);

  const points: VolumePoint[] = [];
  const last = truncate(end, bucket);
  let cursor = truncate(start, bucket);
  let truncated = false;

  while (cursor.getTime() <= last.getTime()) {
    if (points.length >= MAX_POINTS) {
      truncated = true;
      break;
    }
    points.push({
      bucketStart: cursor.toISOString(),
      ...labelsFor(cursor, bucket),
      count: counts.get(cursor.getTime()) ?? 0,
    });
    cursor = advance(cursor, bucket);
  }

  return {
    bucket,
    points,
    total: points.reduce((sum, point) => sum + point.count, 0),
    truncated,
    clamped,
  };
}

/**
 * Groups the filtered feedback by time bucket. `start` and `end` bound the axis:
 * the selected date range when one is set, otherwise the first and last item in
 * the slice, so the chart never invents time the data does not cover.
 */
export async function loadVolume(
  workspaceId: string,
  query: InsightsQuery,
  bucket: Bucket,
  start: Date,
  end: Date,
  clamped: boolean,
): Promise<VolumeSeries> {
  const where = feedbackWhereSql(workspaceId, query);

  const rows = await prisma.$queryRaw<VolumeRow[]>`
    SELECT date_trunc(${bucket}::text, f."createdAt") AS "bucketStart",
           COUNT(*)::int AS "count"
    FROM "Feedback" f
    WHERE ${where}
    GROUP BY 1
    ORDER BY 1 ASC
  `;

  return fill(rows, bucket, start, end, clamped);
}
