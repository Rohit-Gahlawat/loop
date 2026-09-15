import { handler, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { loadInsights } from "./_aggregate";
import { readInsightsQuery } from "./_query";

/**
 * Every response depends on the caller's session and on the query string, so
 * there is nothing here to prerender or cache. Saying so keeps one reader's
 * numbers from ever being served to another.
 */
export const dynamic = "force-dynamic";

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
