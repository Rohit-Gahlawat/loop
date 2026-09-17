import { z } from "zod";
import { handler, ok } from "@/lib/api";
import { requireSession, requireWrite } from "@/lib/auth";
import {
  backfillEmbeddings,
  embeddingCoverage,
  MAX_BACKFILL_BATCH,
} from "@/lib/search/embed";
import { rethrowProviderFailure } from "@/lib/search/model";

export const dynamic = "force-dynamic";

/**
 * GET /api/ask/index
 * How much of the workspace is searchable. A read, so any role may see it.
 */
export const GET = handler(async () => {
  const { workspaceId } = await requireSession();
  return ok(await embeddingCoverage(workspaceId));
});

const backfillSchema = z.object({
  /**
   * Rows to embed in this call. Small values keep a single request short enough
   * to survive a serverless timeout, and the `remaining` count in the reply
   * lets the caller run the next chunk. Omitted means "as many as allowed".
   */
  limit: z.coerce.number().int().min(1).max(MAX_BACKFILL_BATCH).optional(),
});

/**
 * POST /api/ask/index
 * Embeds the workspace's feedback that has no vector yet, in batches, skipping
 * anything already indexed.
 *
 * Writing to the index is a write, so viewers get a 403 here rather than a
 * hidden button. Existing vectors are never re-sent, so running this twice
 * costs nothing the second time.
 */
export const POST = handler(async (req) => {
  const { workspaceId } = await requireWrite();

  // An empty body is a valid "index everything", so a missing body is not an error.
  const raw: unknown = await req.json().catch(() => ({}));
  const input = backfillSchema.parse(raw ?? {});

  try {
    return ok(await backfillEmbeddings(workspaceId, input.limit ?? MAX_BACKFILL_BATCH));
  } catch (error) {
    rethrowProviderFailure(error);
  }
});
