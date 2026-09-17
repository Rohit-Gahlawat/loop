import { handler, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { loadThemeTrends } from "../_trends";
import { readThemeQuery } from "../_query";

export const dynamic = "force-dynamic";

/**
 * GET /api/themes/trends
 * The same theme counts as `GET /api/themes`, plus the volume of each charted
 * theme over time. Split from that route because the series costs a second
 * grouped query, and a caller that only wants the counts should not pay for it.
 */
export const GET = handler(async (req) => {
  const { workspaceId } = await requireSession();
  const query = readThemeQuery(new URL(req.url).searchParams);

  return ok(await loadThemeTrends(workspaceId, query, { series: true }));
});
