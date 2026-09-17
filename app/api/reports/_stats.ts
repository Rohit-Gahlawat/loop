import { prisma } from "@/lib/db";
import { loadVolume, resolveBucket, spanInDays } from "@/app/api/insights/_volume";
import {
  MAX_QUOTES,
  MAX_THEMES,
  type ChannelCount,
  type ReportPeriod,
  type ReportQuote,
  type ReportStats,
  type SentimentKey,
  type SentimentSlice,
  type ThemeCount,
} from "./_content";

/**
 * Every figure a report prints, computed in Postgres.
 *
 * This is the whole point of the split: the numbers are counted by the
 * database against the caller's workspace, and only then is a model asked to
 * write around them. Nothing below is estimated, rounded by a model, or
 * inferred from a sample. If a section has no data, it says so rather than
 * producing a zero that reads like a finding.
 *
 * Classification has not shipped yet, so every `sentiment` is null and no
 * feedback carries a theme. The queries here are written for the finished
 * state and will fill in on their own the moment the pipeline starts writing;
 * until then the `available` flags are false and the report shows an empty
 * state. Nothing is substituted for the missing values.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Worst to best, so the sentiment table reads in a fixed order. */
const SENTIMENT_ORDER: SentimentKey[] = ["NEG", "NEU", "POS"];

/** A period longer than this is refused rather than silently truncated. */
export const MAX_PERIOD_DAYS = 400;

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC today, so a report run twice in one day covers the same days. */
export function today(): string {
  return toDay(new Date());
}

/**
 * Resolves the reported period and the one it is compared against.
 *
 * The comparison period is the same number of days ending the day before the
 * reported one starts, so "up on last month" means against a month of equal
 * length rather than against whatever happens to precede it.
 */
export function resolvePeriod(from: string | undefined, to: string | undefined): ReportPeriod {
  const end = to ?? today();
  const endDate = toDate(end);
  const startDate = from ? toDate(from) : new Date(endDate.getTime() - 29 * DAY_MS);
  const start = from ?? toDay(startDate);

  const days = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
  const previousTo = new Date(startDate.getTime() - DAY_MS);
  const previousFrom = new Date(previousTo.getTime() - (days - 1) * DAY_MS);

  return {
    from: start,
    to: end,
    previousFrom: toDay(previousFrom),
    previousTo: toDay(previousTo),
    days,
  };
}

/** Inclusive bounds, matching the convention the dashboard and inbox already use. */
function startOf(day: string): string {
  return `${day}T00:00:00.000`;
}
function endOf(day: string): string {
  return `${day}T23:59:59.999`;
}

type ChannelRow = { channel: string; current: number; previous: number };
type SentimentRow = { sentiment: string | null; current: number; previous: number };
type ThemeRow = {
  id: string;
  name: string;
  color: string;
  current: number;
  previous: number;
};
type QuoteRow = {
  id: string;
  content: string;
  channel: string;
  customerLabel: string | null;
  sentiment: SentimentKey | null;
  createdAt: Date;
};

function share(count: number, total: number): number | null {
  return total > 0 ? count / total : null;
}

/**
 * Loads the period's statistics for one workspace.
 *
 * `workspaceId` comes from the session. Every query below names it in its WHERE
 * clause, including the theme join, which reaches feedback only through rows
 * already scoped to this workspace.
 */
export async function loadReportStats(
  workspaceId: string,
  period: ReportPeriod,
): Promise<ReportStats> {
  const curFrom = startOf(period.from);
  const curTo = endOf(period.to);
  const prevFrom = startOf(period.previousFrom);
  const prevTo = endOf(period.previousTo);

  // One transaction, so every section of the report describes the same instant.
  const [channelRows, sentimentRows, themeRows, taggedRows, themeCountRows, quoteRows] =
    await prisma.$transaction([
      prisma.$queryRaw<ChannelRow[]>`
        SELECT f."channel" AS "channel",
               COUNT(*) FILTER (
                 WHERE f."createdAt" >= ${curFrom}::timestamp AND f."createdAt" <= ${curTo}::timestamp
               )::int AS "current",
               COUNT(*) FILTER (
                 WHERE f."createdAt" >= ${prevFrom}::timestamp AND f."createdAt" <= ${prevTo}::timestamp
               )::int AS "previous"
        FROM "Feedback" f
        WHERE f."workspaceId" = ${workspaceId}
          AND f."createdAt" >= ${prevFrom}::timestamp
          AND f."createdAt" <= ${curTo}::timestamp
        GROUP BY 1
        ORDER BY 2 DESC, 1 ASC
      `,

      prisma.$queryRaw<SentimentRow[]>`
        SELECT f."sentiment"::text AS "sentiment",
               COUNT(*) FILTER (
                 WHERE f."createdAt" >= ${curFrom}::timestamp AND f."createdAt" <= ${curTo}::timestamp
               )::int AS "current",
               COUNT(*) FILTER (
                 WHERE f."createdAt" >= ${prevFrom}::timestamp AND f."createdAt" <= ${prevTo}::timestamp
               )::int AS "previous"
        FROM "Feedback" f
        WHERE f."workspaceId" = ${workspaceId}
          AND f."createdAt" >= ${prevFrom}::timestamp
          AND f."createdAt" <= ${curTo}::timestamp
        GROUP BY 1
      `,

      // The join onto Feedback carries the workspace filter, so a theme can only
      // ever be counted against this tenant's own rows.
      prisma.$queryRaw<ThemeRow[]>`
        SELECT t."id" AS "id",
               t."name" AS "name",
               t."color" AS "color",
               COUNT(f."id") FILTER (
                 WHERE f."createdAt" >= ${curFrom}::timestamp AND f."createdAt" <= ${curTo}::timestamp
               )::int AS "current",
               COUNT(f."id") FILTER (
                 WHERE f."createdAt" >= ${prevFrom}::timestamp AND f."createdAt" <= ${prevTo}::timestamp
               )::int AS "previous"
        FROM "Theme" t
        LEFT JOIN "FeedbackTheme" ft ON ft."themeId" = t."id"
        LEFT JOIN "Feedback" f
               ON f."id" = ft."feedbackId"
              AND f."workspaceId" = ${workspaceId}
              AND f."createdAt" >= ${prevFrom}::timestamp
              AND f."createdAt" <= ${curTo}::timestamp
        WHERE t."workspaceId" = ${workspaceId}
        GROUP BY t."id", t."name", t."color"
      `,

      prisma.$queryRaw<{ tagged: number }[]>`
        SELECT COUNT(DISTINCT f."id")::int AS "tagged"
        FROM "Feedback" f
        JOIN "FeedbackTheme" ft ON ft."feedbackId" = f."id"
        WHERE f."workspaceId" = ${workspaceId}
          AND f."createdAt" >= ${curFrom}::timestamp
          AND f."createdAt" <= ${curTo}::timestamp
      `,

      prisma.$queryRaw<{ themes: number }[]>`
        SELECT COUNT(*)::int AS "themes" FROM "Theme" t WHERE t."workspaceId" = ${workspaceId}
      `,

      /**
       * Representative quotes, chosen by a rule rather than by a model: the
       * longest item from each channel, channels taken in order of volume. A
       * longer item carries more of what the customer actually meant than the
       * one that happens to be newest, and one per channel keeps a single noisy
       * source from supplying the whole set.
       */
      prisma.$queryRaw<QuoteRow[]>`
        SELECT "id", "content", "channel", "customerLabel", "sentiment", "createdAt"
        FROM (
          SELECT f."id",
                 f."content",
                 f."channel",
                 f."customerLabel",
                 f."sentiment",
                 f."createdAt",
                 ROW_NUMBER() OVER (
                   PARTITION BY f."channel"
                   ORDER BY length(f."content") DESC, f."createdAt" DESC, f."id" ASC
                 ) AS "rank",
                 COUNT(*) OVER (PARTITION BY f."channel") AS "channelCount"
          FROM "Feedback" f
          WHERE f."workspaceId" = ${workspaceId}
            AND f."createdAt" >= ${curFrom}::timestamp
            AND f."createdAt" <= ${curTo}::timestamp
        ) ranked
        WHERE "rank" = 1
        ORDER BY "channelCount" DESC, "channel" ASC
        LIMIT ${MAX_QUOTES}
      `,
    ]);

  const byChannel: ChannelCount[] = channelRows.map((row) => ({
    channel: row.channel,
    current: row.current,
    previous: row.previous,
  }));

  const total = byChannel.reduce((sum, row) => sum + row.current, 0);
  const previousTotal = byChannel.reduce((sum, row) => sum + row.previous, 0);

  const sentimentCurrent = new Map<string | null, number>();
  const sentimentPrevious = new Map<string | null, number>();
  for (const row of sentimentRows) {
    sentimentCurrent.set(row.sentiment, row.current);
    sentimentPrevious.set(row.sentiment, row.previous);
  }

  const classified = SENTIMENT_ORDER.reduce(
    (sum, key) => sum + (sentimentCurrent.get(key) ?? 0),
    0,
  );
  const previousClassified = SENTIMENT_ORDER.reduce(
    (sum, key) => sum + (sentimentPrevious.get(key) ?? 0),
    0,
  );

  const slices: SentimentSlice[] = SENTIMENT_ORDER.map((key) => {
    const current = sentimentCurrent.get(key) ?? 0;
    const previous = sentimentPrevious.get(key) ?? 0;
    const currentShare = share(current, classified);
    const previousShare = share(previous, previousClassified);
    return {
      key,
      current,
      previous,
      currentShare,
      previousShare,
      // Percentage points, which is the only honest way to describe a share moving.
      shift:
        currentShare === null || previousShare === null
          ? null
          : (currentShare - previousShare) * 100,
    };
  });

  const taggedItems = taggedRows[0]?.tagged ?? 0;
  const themes: ThemeCount[] = themeRows
    .map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      current: row.current,
      previous: row.previous,
      share: share(row.current, taggedItems),
    }))
    .sort((a, b) => b.current - a.current || a.name.localeCompare(b.name))
    .slice(0, MAX_THEMES);

  const quotes: ReportQuote[] = quoteRows.map((row) => ({
    id: row.id,
    content: row.content,
    channel: row.channel,
    customerLabel: row.customerLabel,
    sentiment: row.sentiment,
    createdAt: row.createdAt.toISOString(),
  }));

  // The same grouping the dashboard's volume chart uses, so the two agree.
  const start = toDate(period.from);
  const end = new Date(`${period.to}T23:59:59.999Z`);
  const bucket = resolveBucket("auto", spanInDays(start, end));
  const series = await loadVolume(
    workspaceId,
    { bucket, from: period.from, to: period.to },
    bucket,
    start,
    end,
    false,
  );

  return {
    volume: {
      total,
      previousTotal,
      changePct: previousTotal > 0 ? ((total - previousTotal) / previousTotal) * 100 : null,
      bucket,
      series: series.points.map((point) => ({
        bucketStart: point.bucketStart,
        label: point.label,
        count: point.count,
      })),
      byChannel,
    },
    sentiment: {
      slices,
      classified,
      unclassified: total - classified,
      previousClassified,
      available: classified > 0,
    },
    themes: {
      items: themes,
      taggedItems,
      themeCount: themeCountRows[0]?.themes ?? 0,
      available: taggedItems > 0,
    },
    quotes,
  };
}
