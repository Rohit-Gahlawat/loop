import { handler, ok, parseJson } from "@/lib/api";
import { requireSession, requireWrite } from "@/lib/auth";
import { rethrowProviderFailure } from "@/lib/search/model";
import { generateReport } from "./_generate";
import { generateReportSchema, listReports, readReportListQuery } from "./_query";

/** Every response depends on the caller's workspace, so there is nothing to cache. */
export const dynamic = "force-dynamic";

/**
 * GET /api/reports
 * Saved reports for the caller's workspace, newest first.
 *
 * Reading is open to every role, viewers included: a report exists to be read.
 */
export const GET = handler(async (req) => {
  const { workspaceId } = await requireSession();
  const query = readReportListQuery(new URL(req.url).searchParams);

  return ok(await listReports(workspaceId, query));
});

/**
 * POST /api/reports
 * Generates a report for a period and saves it.
 *
 * Generating writes a row and spends a model call, so it is a write: viewers
 * get a 403 here, not merely a hidden button. The period defaults to the last
 * thirty days.
 */
export const POST = handler(async (req) => {
  const principal = await requireWrite();
  const input = await parseJson(req, generateReportSchema);

  try {
    return ok(await generateReport(principal, input), 201);
  } catch (error) {
    rethrowProviderFailure(error);
  }
});
