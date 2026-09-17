import { FeedbackStatus, Sentiment } from "@prisma/client";
import { z } from "zod";
import { UNCLASSIFIED } from "../feedback/_constants";
import { BUCKETS } from "../insights/_query";
import type { InsightsQuery } from "../insights/_query";
import { DEFAULT_WINDOW_DAYS, WINDOWS } from "./_constants";

/**
 * Reading themes: the same filters the inbox and the dashboard use, plus the
 * comparison window.
 *
 * The filter vocabulary is deliberately identical to `feedback/_query.ts` and
 * `insights/_query.ts`: the same keys, the same coercion, the same "empty means
 * no filter" rule. A link copied from the dashboard filters this page to the
 * same slice of feedback, and a theme clicked here filters the inbox to the
 * items behind the number.
 *
 * `window` is the only addition, and it is not a filter. It says how long a
 * period a theme is compared against itself over: the last fourteen days
 * against the fourteen before them, by default.
 */

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like YYYY-MM-DD.");

export const themeQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    channel: z.string().trim().min(1).max(80).optional(),
    sentiment: z.union([z.nativeEnum(Sentiment), z.literal(UNCLASSIFIED)]).optional(),
    themeId: z.string().trim().min(1).max(60).optional(),
    status: z.nativeEnum(FeedbackStatus).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    bucket: z.enum(BUCKETS).default("auto"),
    window: z.coerce
      .number()
      .int()
      .refine(
        (value): value is (typeof WINDOWS)[number] =>
          (WINDOWS as readonly number[]).includes(value),
        `The comparison window must be one of ${WINDOWS.join(", ")} days.`,
      )
      .default(DEFAULT_WINDOW_DAYS),
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

export type ThemeQuery = z.infer<typeof themeQuerySchema>;

/**
 * Search params arrive as strings, repeated keys or empty strings. Empty means
 * "no filter", not "filter on an empty value", so those are dropped before Zod
 * sees them and the defaults apply. Same rule as the inbox and the dashboard.
 */
export function readThemeQuery(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): ThemeQuery {
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

  return themeQuerySchema.parse(raw);
}

/**
 * Same thing for the trends page, which gets its params from the address bar. A
 * hand-edited URL should show the unfiltered view with a notice, not an error
 * page, so unparseable input falls back to the defaults.
 */
export function readThemeQuerySafe(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): { query: ThemeQuery; invalid: boolean } {
  try {
    return { query: readThemeQuery(source), invalid: false };
  } catch {
    return { query: themeQuerySchema.parse({}), invalid: true };
  }
}

/**
 * The dashboard's SQL filter builder takes an `InsightsQuery`. Borrowing it
 * rather than writing a second one is the point: trends can never count a
 * different set of rows from the one the dashboard charts for the same URL.
 */
export function toInsightsQuery(query: ThemeQuery): InsightsQuery {
  return {
    q: query.q,
    channel: query.channel,
    sentiment: query.sentiment,
    themeId: query.themeId,
    status: query.status,
    from: query.from,
    to: query.to,
    bucket: query.bucket,
  };
}
