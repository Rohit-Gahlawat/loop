/**
 * Backing off when the provider says no.
 *
 * The free tier allows only a handful of requests a minute, so a 429 is an
 * ordinary part of a back-fill rather than an exception. Hammering through it
 * would get the whole run throttled, so each attempt waits: for the delay the
 * provider itself asks for where it names one, and otherwise for an exponential
 * delay with jitter so two runs never retry in lockstep.
 *
 * Nothing here logs the request or the credentials, only the status and how
 * long the next attempt waits.
 */

export type RetryOptions = {
  /** Total attempts including the first. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Named in the log line so a slow run says which step is waiting. */
  label?: string;
  /** Called before each wait, so a back-fill can report how much it was throttled. */
  onRetry?: (attempt: number, status: number | null, waitMs: number) => void;
};

const DEFAULT_ATTEMPTS = 4;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 60_000;

/** Throttling, timeouts and the transient server-side failures worth repeating. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The HTTP status behind a provider failure.
 *
 * The Anthropic client puts it on the error object. The OpenAI-compatible path
 * throws a plain Error whose message starts with the status, so that is read
 * back out rather than reimplementing the request to learn it.
 */
export function providerStatus(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }

  if (error instanceof Error) {
    const match = /Model request failed:\s*(\d{3})/.exec(error.message);
    if (match) return Number(match[1]);
  }

  return null;
}

/** A connection that never got far enough to have a status is worth one more go. */
function looksTransient(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /fetch failed|network|socket|ECONNRESET|ETIMEDOUT|EAI_AGAIN|timed? ?out/i.test(
    `${error.name} ${error.message}`,
  );
}

/**
 * Gemini answers a 429 with "Please retry in 9.5s". Honouring that is both
 * politer and faster than guessing, so it wins over the exponential schedule
 * whenever the body carries it.
 */
function providerHintMs(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const match = /retry(?: again)? in ([\d.]+)\s*s/i.exec(error.message);
  if (!match) return null;

  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1_000) : null;
}

export function isRetryable(error: unknown): boolean {
  const status = providerStatus(error);
  if (status !== null) return RETRYABLE_STATUS.has(status);
  return looksTransient(error);
}

/**
 * Runs a provider call, retrying only the failures that repeating can fix. A
 * 400 or a 404, such as a model name the key cannot reach, is raised straight
 * away: waiting would not change the answer.
 */
export async function withProviderRetry<T>(
  run: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelay = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const label = options.label ?? "model call";

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;

      if (attempt === attempts || !isRetryable(error)) break;

      const backoff = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * baseDelay);
      const wait = Math.min(maxDelay, providerHintMs(error) ?? backoff + jitter);

      const status = providerStatus(error);
      options.onRetry?.(attempt, status, wait);

      console.warn(
        `Provider ${label} failed with status ${status ?? "none"}, attempt ${attempt} of ${attempts}, waiting ${wait}ms.`,
      );
      await sleep(wait);
    }
  }

  throw lastError;
}
