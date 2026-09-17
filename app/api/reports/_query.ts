import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/api";
import {
  dateOnly,
  reportContentSchema,
  type ReportContent,
  type ReportDetail,
  type ReportListPage,
  type ReportSummary,
} from "./_content";
import { MAX_PERIOD_DAYS } from "./_stats";

/**
 * Reading and writing saved reports.
 *
 * Shared by the API routes and the report pages, so both apply the same
 * workspace scoping. Nothing here takes a workspace from client input: the id
 * always comes from `requireSession()` at the top of the caller.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const generateReportSchema = z
  .object({
    from: dateOnly.optional(),
    to: dateOnly.optional(),
    title: z
      .string()
      .trim()
      .min(1, "Give the report a title, or leave it blank for the default.")
      .max(120, "Keep the title under 120 characters.")
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.from || !value.to) return;

    if (value.from > value.to) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end of the period is before the start.",
      });
      return;
    }

    const days =
      Math.round(
        (new Date(`${value.to}T00:00:00.000Z`).getTime() -
          new Date(`${value.from}T00:00:00.000Z`).getTime()) /
          DAY_MS,
      ) + 1;

    if (days > MAX_PERIOD_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `A report covers at most ${MAX_PERIOD_DAYS} days.`,
      });
    }
  });

export type GenerateReportInput = z.infer<typeof generateReportSchema>;

export const reportListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  perPage: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

/** Empty strings mean "no value", the same rule the inbox applies. */
export function readReportListQuery(source: URLSearchParams): ReportListQuery {
  const raw: Record<string, string> = {};
  source.forEach((value, key) => {
    if (value.trim() !== "") raw[key] = value;
  });
  return reportListQuerySchema.parse(raw);
}

const reportSelect = {
  id: true,
  title: true,
  periodStart: true,
  periodEnd: true,
  contentJson: true,
  createdAt: true,
  generatedBy: { select: { id: true, name: true } },
} satisfies Prisma.ReportSelect;

type ReportRow = Prisma.ReportGetPayload<{ select: typeof reportSelect }>;

/**
 * Stored content is validated on the way out as well as on the way in.
 *
 * A report written by an earlier build may no longer match the schema. Saying
 * so is better than rendering half a report, and better still than letting a
 * missing field throw on a page nobody can then open.
 */
export function parseContent(value: Prisma.JsonValue): ReportContent | null {
  const result = reportContentSchema.safeParse(value);
  return result.success ? result.data : null;
}

function toSummary(row: ReportRow): ReportSummary {
  const content = parseContent(row.contentJson);

  return {
    id: row.id,
    title: row.title,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    createdAt: row.createdAt.toISOString(),
    generatedBy: row.generatedBy,
    total: content?.stats.volume.total ?? null,
    headline: content?.narrative?.headline ?? null,
  };
}

/** One bounded page of reports, newest first. */
export async function listReports(
  workspaceId: string,
  query: ReportListQuery,
): Promise<ReportListPage> {
  const where: Prisma.ReportWhereInput = { workspaceId };

  const [total, rows] = await prisma.$transaction([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      select: reportSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.perPage,
      take: query.perPage,
    }),
  ]);

  return {
    items: rows.map(toSummary),
    page: query.page,
    perPage: query.perPage,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.perPage)),
  };
}

/**
 * One report. The workspace is part of the lookup, so an id from another tenant
 * is a 404 here rather than a leak.
 */
export async function getReport(workspaceId: string, id: string): Promise<ReportDetail> {
  const row = await prisma.report.findFirst({
    where: { id, workspaceId },
    select: reportSelect,
  });

  if (!row) throw notFound("That report does not exist.");

  const content = parseContent(row.contentJson);
  if (!content) {
    throw notFound("That report was saved in a format this version cannot read.");
  }

  return {
    id: row.id,
    title: row.title,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    createdAt: row.createdAt.toISOString(),
    generatedBy: row.generatedBy,
    content,
  };
}
