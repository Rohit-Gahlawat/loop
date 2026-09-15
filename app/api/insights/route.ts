import { handler, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { loadInsights } from "./_aggregate";
import { readInsightsQuery } from "./_query";

/**
 * GET /api/insights
 * Every number the dashboard draws, for the caller's workspace only.
 *
 * This is a read, so it needs a session and nothing more: viewers see the
 * dashboard alongside admins and analysts. The filters are the inbox's filters,
 * so the same query string scopes both pages to the same slice of feedback.
 */
export const GET = handler(async (req) => {
  const { workspaceId } = await requireSession();
  const query = readInsightsQuery(new URL(req.url).searchParams);

  return ok(await loadInsights(workspaceId, query));
});
