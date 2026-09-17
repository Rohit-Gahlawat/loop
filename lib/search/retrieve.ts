import type { Sentiment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toVectorLiteral } from "./embed";

/**
 * Nearest-neighbour retrieval over the workspace's feedback.
 *
 * The join runs from `Embedding` into `Feedback` and filters on
 * `Feedback.workspaceId`, so a vector can only ever be reached through a row
 * the caller already owns. There is no code path here that takes a workspace
 * from client input: the caller passes the id from `requireSession()`.
 */

/** A retrieved item, carrying the fields a reader needs to verify the answer. */
export type RetrievedFeedback = {
  id: string;
  content: string;
  channel: string;
  customerLabel: string | null;
  sourceRef: string | null;
  sentiment: Sentiment | null;
  createdAt: string;
  /** Cosine similarity in [0, 1] after normalisation. Higher is closer. */
  similarity: number;
};

type Row = Omit<RetrievedFeedback, "createdAt"> & { createdAt: Date };

/** Sane ceiling: more than this stops helping the answer and starts costing tokens. */
export const MAX_TOP_K = 20;

/**
 * Enough neighbours that a thematic question sees the shape of an opinion
 * rather than its loudest example, and few enough to stay inside the reply
 * budget once the model's own reasoning tokens are counted.
 */
export const DEFAULT_TOP_K = 10;

/**
 * The top `limit` items closest to `vector`.
 *
 * `<=>` is pgvector's cosine distance, so `1 - distance` is the similarity.
 * There is no ANN index on this column, which for a workspace of a few hundred
 * rows is the right trade: an exact scan is fast and cannot miss a neighbour.
 */
export async function searchSimilar(
  workspaceId: string,
  vector: number[],
  limit: number = DEFAULT_TOP_K,
): Promise<RetrievedFeedback[]> {
  const capped = Math.max(1, Math.min(Math.trunc(limit), MAX_TOP_K));
  const literal = toVectorLiteral(vector);

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT f."id",
           f."content",
           f."channel",
           f."customerLabel",
           f."sourceRef",
           f."sentiment",
           f."createdAt",
           (1 - (e."vector" <=> ${literal}::vector))::float8 AS "similarity"
    FROM "Embedding" e
    JOIN "Feedback" f ON f."id" = e."feedbackId"
    WHERE f."workspaceId" = ${workspaceId}
    ORDER BY e."vector" <=> ${literal}::vector, f."id" ASC
    LIMIT ${capped}
  `;

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
