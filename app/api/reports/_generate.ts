import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Principal } from "@/lib/auth";
import { REPORT_CONTENT_VERSION, type ReportContent, type ReportDetail } from "./_content";
import { writeNarrative } from "./_narrative";
import { loadReportStats, resolvePeriod } from "./_stats";
import type { GenerateReportInput } from "./_query";

/**
 * Generating a Voice-of-Customer report.
 *
 * The order matters and is the whole design: count first, write second. The
 * statistics are computed in SQL against the caller's workspace, then handed to
 * the model as context. If the model is unavailable or produces something that
 * cannot be verified, the report is still saved with its real figures and a
 * note where the prose would be. A report is never blocked on a narrative, and
 * a narrative is never allowed to become the source of a figure.
 */

const MONTH_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const FULL_DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function defaultTitle(from: string, to: string): string {
  const start = MONTH_DAY.format(new Date(`${from}T00:00:00.000Z`));
  const end = FULL_DAY.format(new Date(`${to}T00:00:00.000Z`));
  return `Voice of Customer, ${start} to ${end}`;
}

export async function generateReport(
  principal: Principal,
  input: GenerateReportInput,
): Promise<ReportDetail> {
  const period = resolvePeriod(input.from, input.to);
  const stats = await loadReportStats(principal.workspaceId, period);
  const { narrative, issue } = await writeNarrative(period, stats);

  const content: ReportContent = {
    version: REPORT_CONTENT_VERSION,
    period,
    stats,
    narrative,
    narrativeIssue: issue,
    model: process.env.AI_MODEL ?? "unknown",
    generatedAt: new Date().toISOString(),
  };

  const row = await prisma.report.create({
    data: {
      title: input.title ?? defaultTitle(period.from, period.to),
      // Stored as timestamps covering the whole of the first and last day.
      periodStart: new Date(`${period.from}T00:00:00.000Z`),
      periodEnd: new Date(`${period.to}T23:59:59.999Z`),
      contentJson: content as unknown as Prisma.InputJsonValue,
      workspaceId: principal.workspaceId,
      generatedById: principal.userId,
    },
    select: {
      id: true,
      title: true,
      periodStart: true,
      periodEnd: true,
      createdAt: true,
      generatedBy: { select: { id: true, name: true } },
    },
  });

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
