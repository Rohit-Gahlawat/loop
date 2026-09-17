import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Writes a vector for each feedback item so semantic retrieval can find it.
 * Called once per item on ingest, and in bulk by the back-fill.
 *
 * The provider is the same OpenAI-compatible endpoint the chat model uses, so
 * the base URL and key come from the same two variables. Vectors are written
 * with raw SQL: `Embedding.vector` is an `Unsupported()` column and Prisma
 * Client can neither select nor write it. Every value below goes in as a bound
 * parameter, exactly as `app/api/insights/_volume.ts` does it.
 */

/** Matches the `vector(768)` column. Only a fallback: the width is configuration. */
const DEFAULT_DIMENSIONS = 768;

/** The provider accepts an array of inputs. Measured reliable at this size. */
const MAX_INPUTS_PER_REQUEST = 32;

/** Rows written to Postgres per statement, independent of the provider batch. */
const MAX_ROWS_PER_STATEMENT = 50;

/**
 * The free tier meters embeddings per minute, so a back-fill of a few hundred
 * rows will meet a 429 partway through and has to wait out the window rather
 * than give up. Six attempts of doubling backoff span just over a minute.
 */
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 45_000;

/** Statuses worth retrying: rate limiting, and the provider's frequent overload. */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new EmbeddingError(`Missing environment variable: ${name}`);
  return value;
}

/**
 * The stored column is fixed at 768, so the configured width has to agree with
 * it. Reading it from the environment rather than hardcoding means one change
 * of provider moves both the migration and this file in step.
 */
export function embeddingDimensions(): number {
  const raw = process.env.EMBEDDING_DIMENSIONS;
  if (!raw) return DEFAULT_DIMENSIONS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new EmbeddingError(`EMBEDDING_DIMENSIONS is not a positive integer: ${raw}`);
  }
  return parsed;
}

/** The provider's reply. Parsed, never trusted by shape alone. */
const embeddingResponseSchema = z.object({
  data: z
    .array(
      z.object({
        index: z.number().int().nonnegative().optional(),
        embedding: z.array(z.number()).min(1),
      }),
    )
    .min(1),
});

/** Google returns a retry hint inside the error body. Honour it when it is there. */
const retryHintSchema = z.object({
  error: z.object({
    details: z.array(z.object({ retryDelay: z.string().optional() })).optional(),
  }),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Seconds from a `Retry-After` header or a Google `retryDelay` such as "31s". */
function retryAfterMs(response: Response, body: string): number | null {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number.parseFloat(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  }

  try {
    const hint = retryHintSchema.safeParse(JSON.parse(body));
    if (!hint.success) return null;
    for (const detail of hint.data.error.details ?? []) {
      const match = detail.retryDelay?.match(/^(\d+(?:\.\d+)?)s$/);
      if (match) return Number.parseFloat(match[1]) * 1_000;
    }
  } catch {
    return null;
  }
  return null;
}

function backoffMs(attempt: number, hint: number | null): number {
  const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  // A little jitter, so parallel back-fills do not line up on the same second.
  return Math.min(Math.max(hint ?? exponential, exponential), MAX_BACKOFF_MS) + Math.random() * 250;
}

/**
 * Cuts an over-long vector to the column width and re-normalises it.
 *
 * The provider honours the requested width today, but a longer reply is a
 * provider change rather than a reason to lose an ingest: the leading
 * components of these embeddings carry the most signal, so truncating and
 * re-normalising keeps cosine distance meaningful. A short reply is a genuine
 * mismatch and is refused, because padding would corrupt the distance.
 */
export function fitVector(vector: number[], width: number): number[] {
  if (vector.length < width) {
    throw new EmbeddingError(
      `Embedding provider returned ${vector.length} values, fewer than the required ${width}.`,
    );
  }

  const cut = vector.length === width ? vector : vector.slice(0, width);
  let sumOfSquares = 0;
  for (const value of cut) sumOfSquares += value * value;

  const magnitude = Math.sqrt(sumOfSquares);
  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new EmbeddingError("Embedding provider returned a zero or non-finite vector.");
  }

  return cut.map((value) => value / magnitude);
}

/** pgvector's text form. Bound as a parameter and cast in SQL, never concatenated. */
export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

/** One provider call for up to `MAX_INPUTS_PER_REQUEST` texts, with backoff. */
async function requestEmbeddings(inputs: string[], width: number): Promise<number[][]> {
  const url = `${env("AI_BASE_URL")}/embeddings`;
  const body = JSON.stringify({
    model: env("EMBEDDING_MODEL"),
    input: inputs,
    dimensions: width,
  });

  let lastError: EmbeddingError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env("AI_API_KEY")}`,
        },
        body,
      });
    } catch (cause) {
      // A dropped connection is worth the same retry as a 503.
      lastError = new EmbeddingError(
        `Embedding request could not be sent: ${cause instanceof Error ? cause.message : "unknown error"}`,
      );
      await sleep(backoffMs(attempt, null));
      continue;
    }

    const text = await response.text();

    if (!response.ok) {
      // The body can carry the key back in an error echo, so it is never logged.
      lastError = new EmbeddingError(
        `Embedding request failed with HTTP ${response.status}.`,
        response.status,
      );
      if (!RETRYABLE.has(response.status) || attempt === MAX_ATTEMPTS - 1) throw lastError;
      await sleep(backoffMs(attempt, retryAfterMs(response, text)));
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new EmbeddingError("Embedding provider returned a body that is not JSON.");
    }

    const result = embeddingResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw new EmbeddingError("Embedding provider returned an unexpected shape.");
    }
    if (result.data.data.length !== inputs.length) {
      throw new EmbeddingError(
        `Embedding provider returned ${result.data.data.length} vectors for ${inputs.length} inputs.`,
      );
    }

    // `index` is optional in the reply, so fall back to arrival order.
    const ordered = [...result.data.data].sort(
      (a, b) => (a.index ?? 0) - (b.index ?? 0),
    );
    return ordered.map((row) => fitVector(row.embedding, width));
  }

  throw lastError ?? new EmbeddingError("Embedding request failed.");
}

export type EmbedTextsResult = {
  vectors: number[][];
  /** Provider calls made. The back-fill reports this so its cost is visible. */
  requests: number;
};

/**
 * Embeds any number of texts, splitting them into provider-sized requests.
 * Order is preserved, so `vectors[i]` belongs to `texts[i]`.
 */
export async function embedTexts(texts: string[]): Promise<EmbedTextsResult> {
  if (texts.length === 0) return { vectors: [], requests: 0 };

  const width = embeddingDimensions();
  const vectors: number[][] = [];
  let requests = 0;

  for (let start = 0; start < texts.length; start += MAX_INPUTS_PER_REQUEST) {
    const slice = texts.slice(start, start + MAX_INPUTS_PER_REQUEST);
    vectors.push(...(await requestEmbeddings(slice, width)));
    requests += 1;
  }

  return { vectors, requests };
}

/** One text, for the question side of a search. */
export async function embedQuery(text: string): Promise<number[]> {
  const { vectors } = await embedTexts([text]);
  const vector = vectors[0];
  if (!vector) throw new EmbeddingError("Embedding provider returned nothing for the question.");
  return vector;
}

/**
 * Upserts vectors by feedback id.
 *
 * The id column has no database-side default (Prisma applies `cuid()` in the
 * client, which cannot reach an Unsupported column), so one is supplied here.
 * `ON CONFLICT` means a re-embed replaces rather than fails, which is what the
 * pipeline wants when an item is ingested twice.
 */
async function storeVectors(rows: { feedbackId: string; vector: number[] }[]): Promise<void> {
  for (let start = 0; start < rows.length; start += MAX_ROWS_PER_STATEMENT) {
    const slice = rows.slice(start, start + MAX_ROWS_PER_STATEMENT);
    const values = slice.map(
      (row) =>
        Prisma.sql`(${randomUUID()}, ${toVectorLiteral(row.vector)}::vector, ${row.feedbackId})`,
    );

    await prisma.$executeRaw`
      INSERT INTO "Embedding" ("id", "vector", "feedbackId")
      VALUES ${Prisma.join(values)}
      ON CONFLICT ("feedbackId") DO UPDATE
        SET "vector" = EXCLUDED."vector", "createdAt" = NOW()
    `;
  }
}

export type EmbedResult = {
  embedded: number;
  /** Ids that were not this workspace's, or no longer exist. */
  skipped: number;
  requests: number;
};

/**
 * Embeds the given feedback and stores the vectors.
 *
 * The ids are re-read against the caller's workspace before anything is sent to
 * the provider, so an id from another tenant simply falls out rather than
 * seeding that tenant's text into this workspace's index.
 */
export async function embedBatch(
  feedbackIds: string[],
  workspaceId: string,
): Promise<EmbedResult> {
  if (feedbackIds.length === 0) return { embedded: 0, skipped: 0, requests: 0 };

  const unique = Array.from(new Set(feedbackIds));
  const rows = await prisma.feedback.findMany({
    where: { id: { in: unique }, workspaceId },
    select: { id: true, content: true },
    orderBy: { id: "asc" },
  });

  if (rows.length === 0) return { embedded: 0, skipped: unique.length, requests: 0 };

  const { vectors, requests } = await embedTexts(rows.map((row) => row.content));
  await storeVectors(rows.map((row, index) => ({ feedbackId: row.id, vector: vectors[index] })));

  return { embedded: rows.length, skipped: unique.length - rows.length, requests };
}

export type EmbeddingCoverage = {
  total: number;
  embedded: number;
  missing: number;
};

/** How much of the workspace is searchable. Drives the honest empty state on /ask. */
export async function embeddingCoverage(workspaceId: string): Promise<EmbeddingCoverage> {
  const [rows] = await prisma.$queryRaw<{ total: number; embedded: number }[]>`
    SELECT COUNT(*)::int AS "total",
           COUNT(e."feedbackId")::int AS "embedded"
    FROM "Feedback" f
    LEFT JOIN "Embedding" e ON e."feedbackId" = f."id"
    WHERE f."workspaceId" = ${workspaceId}
  `;

  const total = rows?.total ?? 0;
  const embedded = rows?.embedded ?? 0;
  return { total, embedded, missing: total - embedded };
}

export type BackfillResult = EmbeddingCoverage & {
  /** Rows embedded by this run. */
  embeddedNow: number;
  requests: number;
  durationMs: number;
  /** Rows still missing a vector after this run, so a caller can loop. */
  remaining: number;
};

/** Ceiling on one back-fill run, so a single request cannot run unbounded. */
export const MAX_BACKFILL_BATCH = 500;

/**
 * Gives a vector to every item in the workspace that has none.
 *
 * Rows that already carry a vector are never re-sent, so this is safe to run
 * repeatedly and cheap to run a second time. The work is chunked, and each
 * chunk is written before the next is requested, so a provider failure halfway
 * leaves the earlier chunks stored rather than losing the whole run.
 */
export async function backfillEmbeddings(
  workspaceId: string,
  limit: number = MAX_BACKFILL_BATCH,
): Promise<BackfillResult> {
  const started = Date.now();
  const capped = Math.max(1, Math.min(limit, MAX_BACKFILL_BATCH));

  const pending = await prisma.$queryRaw<{ id: string; content: string }[]>`
    SELECT f."id", f."content"
    FROM "Feedback" f
    LEFT JOIN "Embedding" e ON e."feedbackId" = f."id"
    WHERE f."workspaceId" = ${workspaceId} AND e."feedbackId" IS NULL
    ORDER BY f."createdAt" DESC, f."id" DESC
    LIMIT ${capped}
  `;

  let embeddedNow = 0;
  let requests = 0;

  for (let start = 0; start < pending.length; start += MAX_INPUTS_PER_REQUEST) {
    const slice = pending.slice(start, start + MAX_INPUTS_PER_REQUEST);
    const result = await embedTexts(slice.map((row) => row.content));
    requests += result.requests;
    await storeVectors(
      slice.map((row, index) => ({ feedbackId: row.id, vector: result.vectors[index] })),
    );
    embeddedNow += slice.length;
  }

  const coverage = await embeddingCoverage(workspaceId);

  return {
    ...coverage,
    embeddedNow,
    requests,
    durationMs: Date.now() - started,
    remaining: coverage.missing,
  };
}
