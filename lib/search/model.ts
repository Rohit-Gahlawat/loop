import type { ZodType } from "zod";
import { complete } from "@/lib/ai/provider";
import { ApiError } from "@/lib/api";
import { EmbeddingError } from "./embed";

/**
 * Talking to the chat model safely.
 *
 * `lib/ai/provider.ts` owns the single HTTP call and is deliberately thin: it
 * has no retry, and it returns whatever text the model produced. Everything
 * that has to be true before that text is allowed near the database or the UI
 * lives here, so Ask LOOP and the report generator share one set of rules
 * rather than each inventing its own.
 *
 * This file sits under lib/search because lib/ai belongs to the classification
 * work. It only wraps that module and never replaces it.
 */

/** The provider is overloaded far more often than it is rate limited. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 20_000;

/**
 * Internal reasoning tokens are charged against this budget, so a small ceiling
 * truncates the reply mid-JSON rather than shortening the answer.
 */
export const DEFAULT_MAX_TOKENS = 1_600;

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/** The reply arrived but was not the JSON that was asked for. */
export class ModelFormatError extends ModelError {
  constructor(message: string) {
    super(message);
    this.name = "ModelFormatError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The provider throws `Model request failed: <status> <body>`, which is the only
 * place the HTTP status survives. Reading it back out is what lets a 503 be
 * retried and a 400 be given up on straight away.
 */
function statusOf(error: unknown): number | undefined {
  if (!(error instanceof Error)) return undefined;
  const match = error.message.match(/failed:\s*(\d{3})\b/);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

export type CompleteRequest = {
  system: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
};

/** One completion, retried through the provider's overload responses. */
export async function completeWithRetry({
  system,
  prompt,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = 0,
}: CompleteRequest): Promise<string> {
  let last: ModelError | null = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const text = await complete({ system, prompt, maxTokens, temperature });
      if (text.trim() === "") throw new ModelError("The model returned an empty reply.");
      return text;
    } catch (error) {
      const status = statusOf(error);
      // The error text can contain the request body, so only the status is kept.
      last = new ModelError(
        status
          ? `The model provider returned HTTP ${status}.`
          : "The model provider could not be reached.",
        status,
      );

      const retryable = status === undefined || RETRYABLE_STATUS.has(status);
      if (!retryable || attempt === MAX_ATTEMPTS - 1) throw last;

      const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      await sleep(delay + Math.random() * 250);
    }
  }

  throw last ?? new ModelError("The model provider could not be reached.");
}

/**
 * Pulls the JSON object out of a reply.
 *
 * The model wraps JSON in a markdown fence whatever the instruction says, and
 * sometimes writes a sentence before it, so neither is treated as a failure.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();

  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new ModelFormatError("The model did not return a JSON object.");
  }

  return body.slice(start, end + 1);
}

/** Parses and validates a reply. An invalid reply is an error, never a guess. */
export function parseModelJson<T>(raw: string, schema: ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (error) {
    if (error instanceof ModelFormatError) throw error;
    throw new ModelFormatError("The model returned malformed JSON.");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ModelFormatError(
      `The model reply did not match the expected shape: ${result.error.issues
        .map((issue) => `${issue.path.join(".") || "root"} ${issue.message}`)
        .join("; ")}`,
    );
  }

  return result.data;
}

/**
 * A provider that is overloaded, rate limited or talking nonsense is a 503 the
 * caller can act on, not an opaque 500. Anything else is left alone so a real
 * bug still surfaces as one.
 */
export function rethrowProviderFailure(error: unknown): never {
  if (error instanceof ModelFormatError) {
    throw new ApiError(
      502,
      "MODEL_INVALID_REPLY",
      "The model did not return a usable answer. Try again.",
    );
  }
  if (error instanceof ModelError || error instanceof EmbeddingError) {
    throw new ApiError(
      503,
      "MODEL_UNAVAILABLE",
      `${error.message} This provider rate limits heavily. Wait a moment and try again.`,
    );
  }
  throw error;
}

export type CompleteJsonRequest<T> = CompleteRequest & {
  schema: ZodType<T>;
  /** Appended to the prompt on a retry, naming what was wrong the first time. */
  repairHint?: string;
};

/**
 * A completion that must parse against a schema.
 *
 * A reply that fails validation is retried once with the failure quoted back,
 * which recovers the usual case of a stray field or a truncated array. A second
 * failure is raised: an answer that cannot be validated is not shown.
 */
export async function completeJson<T>({
  schema,
  repairHint,
  ...request
}: CompleteJsonRequest<T>): Promise<T> {
  const first = await completeWithRetry(request);

  try {
    return parseModelJson(first, schema);
  } catch (error) {
    if (!(error instanceof ModelFormatError)) throw error;

    const retry = await completeWithRetry({
      ...request,
      prompt: `${request.prompt}\n\nYour previous reply was rejected: ${error.message}\n${
        repairHint ?? "Reply with the JSON object only, and nothing else."
      }`,
    });

    return parseModelJson(retry, schema);
  }
}
