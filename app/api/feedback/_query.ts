import { FeedbackStatus, Prisma, Sentiment } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Reading feedback: filters, search and pagination.
 *
 * Shared by `GET /api/feedback` and the inbox server page so both apply exactly
 * the same rules. Every function here takes the caller's workspaceId and puts it
 * in the where clause. Nothing in this module can read across workspaces.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Rows the pipeline has not classified yet. Selectable as a sentiment filter. */
export const UNCLASSIFIED = "UNCLASSIFIED";

const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like YYYY-MM-DD.");

export const feedbackQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    // Capped, so no request can ever ask for the whole table.
    perPage: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    q: z.string().trim().max(200).optional(),
    channel: z.string().trim().min(1).max(80).optional(),
    sentiment: z.union([z.nativeEnum(Sentiment), z.literal(UNCLASSIFIED)]).optional(),
    themeId: z.string().trim().min(1).max(60).optional(),
    status: z.nativeEnum(FeedbackStatus).optional(),
    from: dateOnly.optional(),
    to: dateOnly.optional(),
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

export type FeedbackQuery = z.infer<typeof feedbackQuerySchema>;

/**
 * Search params arrive as strings, repeated keys or empty strings. Empty means
 * "no filter", not "filter on an empty value", so those are dropped before Zod
 * sees them and the defaults apply.
 */
export function readFeedbackQuery(
  source: URLSearchParams | Record<string, string | string[] | undefined>,
): FeedbackQuery {
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

  return feedbackQuerySchema.parse(raw);
}

/** At most six terms, each of which must appear somewhere in the content. */
function searchTerms(query: string | undefined): string[] {
  if (!query) return [];
  return query.split(/\s+/).filter(Boolean).slice(0, 6);
}

function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const filter: Prisma.DateTimeFilter = {};
  if (from) filter.gte = new Date(`${from}T00:00:00.000Z`);
  // The end of the range is inclusive: "to 2026-09-10" includes that whole day.
  if (to) filter.lte = new Date(`${to}T23:59:59.999Z`);
  return filter;
}

/**
 * The workspaceId is the first thing in the where clause and is never taken from
 * client input. A themeId belonging to another workspace simply matches nothing,
 * because the join can only reach feedback already scoped to this workspace.
 */
export function buildFeedbackWhere(
  workspaceId: string,
  query: FeedbackQuery,
): Prisma.FeedbackWhereInput {
  const where: Prisma.FeedbackWhereInput = { workspaceId };

  if (query.channel) where.channel = query.channel;
  if (query.status) where.status = query.status;
  if (query.sentiment) {
    where.sentiment = query.sentiment === UNCLASSIFIED ? null : query.sentiment;
  }
  if (query.themeId) where.themes = { some: { themeId: query.themeId } };

  const createdAt = dateRange(query.from, query.to);
  if (createdAt) where.createdAt = createdAt;

  const terms = searchTerms(query.q);
  if (terms.length > 0) {
    where.AND = terms.map((term) => ({
      content: { contains: term, mode: Prisma.QueryMode.insensitive },
    }));
  }

  return where;
}

/** The single shape every feedback response uses, list or single row. */
export const feedbackSelect = {
  id: true,
  content: true,
  channel: true,
  sourceRef: true,
  customerLabel: true,
  sentiment: true,
  sentimentScore: true,
  featureArea: true,
  status: true,
  classifiedAt: true,
  createdAt: true,
  themes: {
    select: { theme: { select: { id: true, name: true, color: true } } },
  },
} satisfies Prisma.FeedbackSelect;

type FeedbackRow = Prisma.FeedbackGetPayload<{ select: typeof feedbackSelect }>;

export type FeedbackThemeTag = { id: string; name: string; color: string };

/** Dates are ISO strings so the same shape works over HTTP and across the server boundary. */
export type FeedbackListItem = {
  id: string;
  content: string;
  channel: string;
  sourceRef: string | null;
  customerLabel: string | null;
  sentiment: Sentiment | null;
  sentimentScore: number | null;
  featureArea: string | null;
  status: FeedbackStatus;
  classifiedAt: string | null;
  createdAt: string;
  themes: FeedbackThemeTag[];
};

export type FeedbackPage = {
  items: FeedbackListItem[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

export function serialiseFeedback(row: FeedbackRow): FeedbackListItem {
  return {
    id: row.id,
    content: row.content,
    channel: row.channel,
    sourceRef: row.sourceRef,
    customerLabel: row.customerLabel,
    sentiment: row.sentiment,
    sentimentScore: row.sentimentScore,
    featureArea: row.featureArea,
    status: row.status,
    classifiedAt: row.classifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    themes: row.themes.map((link) => link.theme),
  };
}

/**
 * One bounded page plus the total, taken in a single transaction so the count and
 * the rows agree. Ordering is createdAt then id, which matches the
 * [workspaceId, createdAt] index and keeps paging stable when timestamps tie.
 */
export async function listFeedback(
  workspaceId: string,
  query: FeedbackQuery,
): Promise<FeedbackPage> {
  const where = buildFeedbackWhere(workspaceId, query);

  const [total, rows] = await prisma.$transaction([
    prisma.feedback.count({ where }),
    prisma.feedback.findMany({
      where,
      select: feedbackSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
  ]);

  return {
    items: rows.map(serialiseFeedback),
    page: query.page,
    perPage: query.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}

export type FilterOptions = {
  channels: { value: string; count: number }[];
  themes: FeedbackThemeTag[];
};

/** The channel list is derived from what has actually been ingested, not a fixed enum. */
export async function listFilterOptions(workspaceId: string): Promise<FilterOptions> {
  const [channels, themes] = await Promise.all([
    prisma.feedback.groupBy({
      by: ["channel"],
      where: { workspaceId },
      _count: { _all: true },
      orderBy: { channel: "asc" },
    }),
    prisma.theme.findMany({
      where: { workspaceId },
      select: { id: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    channels: channels.map((row) => ({ value: row.channel, count: row._count._all })),
    themes,
  };
}
