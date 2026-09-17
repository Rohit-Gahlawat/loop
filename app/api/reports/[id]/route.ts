import { handler, ok } from "@/lib/api";
import { requireSession } from "@/lib/auth";
import { getReport } from "../_query";

export const dynamic = "force-dynamic";

type Params = { params: { id: string } };

/**
 * GET /api/reports/:id
 * One saved report, including everything needed to render it.
 *
 * The workspace is part of the lookup, so another tenant's report id is a 404
 * rather than a leak. Any role may read.
 */
export const GET = handler<Params>(async (_req, { params }) => {
  const { workspaceId } = await requireSession();

  return ok(await getReport(workspaceId, params.id));
});
