import { handler, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { loadThemeTrends } from "./_trends";
import { readThemeQuery } from "./_query";

/**
 * Every response depends on the caller's session and on the query string, so
 * there is nothing here to prerender or cache. Saying so keeps one reader's
 * themes from ever being served to another.
 */
export const dynamic = "force-dynamic";

/**
 * GET /api/themes
 * Every theme in the caller's workspace with the number of items behind it,
 * how that number compares with the window before, and how confident the
 * classifier was.
 *
 * This is a read, so it needs a session and nothing more: viewers see theme
 * counts alongside admins and analysts. The filters are the inbox's filters, so
 * the same query string scopes this to the same slice of feedback.
 */
export const GET = handler(async (req) => {
  const { workspaceId } = await requireSession();
  const query = readThemeQuery(new URL(req.url).searchParams);

  return ok(await loadThemeTrends(workspaceId, query));
});
