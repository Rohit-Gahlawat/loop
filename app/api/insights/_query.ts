import { FeedbackStatus, Sentiment } from "@prisma/client";
import { z } from "zod";
import { UNCLASSIFIED } from "../feedback/_constants";
import type { FeedbackQuery } from "../feedback/_query";

/**
 * Reading insights: the same filters the inbox uses, plus a time bucket.
 *
 * The dashboard and the inbox are two views of one slice of feedback, so the
 * filter vocabulary here is deliberately identical to `feedback/_query.ts`: the
 * same keys, the same coercion rules, the same "empty means no filter" handling.
 * A link copied from one page filters the other the same way. The only addition
 * is `bucket`, which is presentation of the time axis rather than a filter.
 */

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like YYYY-MM-DD.");

/** How the volume chart groups time. `auto` picks a bucket from the span. */
export const BUCKETS = ["auto", "day", "week", "month"] as const;
export type BucketInput = (typeof BUCKETS)[number];

/** What the volume chart actually ends up grouping by, after `auto` resolves. */
export type Bucket = Exclude<BucketInput, "auto">;

export const insightsQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    channel: z.string().trim().min(1).max(80).optional(),
    sentiment: z.union([z.nativeEnum(Sentiment), z.literal(UNCLASSIFIED)]).optional(),
    themeId: z.string().trim().min(1).max(60).optional(),
    status: z.nativeEnum(FeedbackStatus).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    bucket: z.enum(BUCKETS).default("auto"),
  })
  .superRefine((value, ctx) => {
    if (value.from && value.to && value.from > value.to) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end of the date range is before the start.",
      });
    }
  });

export type InsightsQuery = z.infer<typeof insightsQuerySchema>;

/**
 * Search params arrive as strings, repeated keys or empty strings. Empty means
 * "no filter", not "filter on an empty value", so those are dropped before Zod
 * sees them and the defaults apply. Same rule as the inbox.
 */
export function readInsightsQuery(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): InsightsQuery {
  const raw: Record<string, string> = {};

  const set = (key: string, value: string | string[] | undefined | null) => {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim() !== "") raw[key] = first;
  };

  if (source instanceof URLSearchParams) {
    source.forEach((value, key) => set(key, value));
  } else {
    for (const [key, value] of Object.entries(source)) set(key, value);
  }

  return insightsQuerySchema.parse(raw);
}

/**
 * Same thing for the dashboard page, which gets its params from the address bar.
 * A hand-edited URL should show the unfiltered dashboard with a notice, not an
 * error page, so unparseable input falls back to the defaults.
 */
export function readInsightsQuerySafe(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): { query: InsightsQuery; invalid: boolean } {
  try {
    return { query: readInsightsQuery(source), invalid: false };
  } catch {
    return { query: insightsQuerySchema.parse({}), invalid: true };
  }
}

/**
 * The inbox builds its where clause from a `FeedbackQuery`, which carries paging
 * as well as filters. The dashboard has no paging, so it borrows that builder by
 * supplying inert paging values. Reusing one builder is the point: the dashboard
 * can never drift into counting a different set of rows from the one the inbox
 * lists for the same URL.
 */
export function toFeedbackQuery(query: InsightsQuery): FeedbackQuery {
  return {
    page: 1,
    perPage: 1,
    q: query.q,
    channel: query.channel,
    sentiment: query.sentiment,
    themeId: query.themeId,
    status: query.status,
    from: query.from,
    to: query.to,
  };
}
