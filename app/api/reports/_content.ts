import { z } from "zod";

/**
 * The shape of a Voice-of-Customer report.
 *
 * Everything a report contains is defined here once, as Zod schemas, and the
 * TypeScript types are inferred from them. That gives one definition for three
 * jobs: validating the model's narrative, validating a row read back out of
 * `Report.contentJson`, and typing the page that renders it. A report written
 * by an older build that no longer parses is shown as an error rather than
 * rendered half empty.
 *
 * Deliberately free of any database import, so the report pages can use these
 * types without pulling Prisma into the browser bundle.
 */

export const REPORT_CONTENT_VERSION = 1;

/** How many verbatim quotes a report carries. */
export const MAX_QUOTES = 6;

/** How many themes a report lists. */
export const MAX_THEMES = 8;

export const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like YYYY-MM-DD.");

const sentimentKey = z.enum(["POS", "NEU", "NEG"]);
export type SentimentKey = z.infer<typeof sentimentKey>;

export const periodSchema = z.object({
  from: dateOnly,
  to: dateOnly,
  previousFrom: dateOnly,
  previousTo: dateOnly,
  /** Inclusive length in days, so the comparison period is the same size. */
  days: z.number().int().positive(),
});
export type ReportPeriod = z.infer<typeof periodSchema>;

const volumePointSchema = z.object({
  bucketStart: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type VolumePoint = z.infer<typeof volumePointSchema>;

const channelCountSchema = z.object({
  channel: z.string(),
  current: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative(),
});
export type ChannelCount = z.infer<typeof channelCountSchema>;

const sentimentSliceSchema = z.object({
  key: sentimentKey,
  current: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative(),
  /** Share of the classified items in each period. Null when nothing is classified. */
  currentShare: z.number().nullable(),
  previousShare: z.number().nullable(),
  /** Percentage points moved. Null when either period has nothing to compare. */
  shift: z.number().nullable(),
});
export type SentimentSlice = z.infer<typeof sentimentSliceSchema>;

const themeCountSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  current: z.number().int().nonnegative(),
  previous: z.number().int().nonnegative(),
  /** Share of the tagged items this period. Null while nothing is tagged. */
  share: z.number().nullable(),
});
export type ThemeCount = z.infer<typeof themeCountSchema>;

const quoteSchema = z.object({
  id: z.string(),
  content: z.string(),
  channel: z.string(),
  customerLabel: z.string().nullable(),
  sentiment: sentimentKey.nullable(),
  createdAt: z.string(),
});
export type ReportQuote = z.infer<typeof quoteSchema>;

export const reportStatsSchema = z.object({
  volume: z.object({
    total: z.number().int().nonnegative(),
    previousTotal: z.number().int().nonnegative(),
    /** Change against the previous period. Null when the previous period was empty. */
    changePct: z.number().nullable(),
    bucket: z.enum(["day", "week", "month"]),
    series: z.array(volumePointSchema),
    byChannel: z.array(channelCountSchema),
  }),
  sentiment: z.object({
    slices: z.array(sentimentSliceSchema),
    classified: z.number().int().nonnegative(),
    unclassified: z.number().int().nonnegative(),
    previousClassified: z.number().int().nonnegative(),
    /** False while classification has not run, which is an empty state, not a zero. */
    available: z.boolean(),
  }),
  themes: z.object({
    items: z.array(themeCountSchema),
    taggedItems: z.number().int().nonnegative(),
    themeCount: z.number().int().nonnegative(),
    available: z.boolean(),
  }),
  quotes: z.array(quoteSchema),
});
export type ReportStats = z.infer<typeof reportStatsSchema>;

/**
 * The written part.
 *
 * Prose only. Every figure in a report comes from `stats`, which is computed in
 * SQL, so the model is asked for the reading of the numbers and never for the
 * numbers themselves.
 */
export const narrativeSchema = z.object({
  headline: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(1_500),
  themes: z.string().trim().min(1).max(1_500),
  sentiment: z.string().trim().min(1).max(1_500),
  quotes: z.string().trim().min(1).max(1_500),
  actions: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        rationale: z.string().trim().min(1).max(600),
      }),
    )
    .min(1)
    .max(5),
});
export type ReportNarrative = z.infer<typeof narrativeSchema>;

export const reportContentSchema = z.object({
  version: z.literal(REPORT_CONTENT_VERSION),
  period: periodSchema,
  stats: reportStatsSchema,
  /** Null when the model could not produce a narrative that passed its checks. */
  narrative: narrativeSchema.nullable(),
  /** Why the narrative is missing, shown to the reader rather than hidden. */
  narrativeIssue: z.string().nullable(),
  model: z.string(),
  generatedAt: z.string(),
});
export type ReportContent = z.infer<typeof reportContentSchema>;

/** What the list and detail routes return. Dates are ISO strings. */
export type ReportSummary = {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  generatedBy: { id: string; name: string } | null;
  /** Null when the stored content no longer parses. */
  total: number | null;
  headline: string | null;
};

export type ReportDetail = Omit<ReportSummary, "total" | "headline"> & {
  content: ReportContent;
};

export type ReportListPage = {
  items: ReportSummary[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};
