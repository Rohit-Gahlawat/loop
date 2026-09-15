/** Shared fetch plumbing for the inbox and ingestion views. */

type ApiFailure = {
  error?: {
    message?: string;
    details?: { path?: string; message?: string }[];
  };
};

export type SendResult<T> = { ok: true; data: T } | { ok: false; message: string };

function readMessage(payload: ApiFailure | null, fallback: string): string {
  const error = payload?.error;
  if (!error) return fallback;

  // Field-level validation messages are far more useful than the envelope's.
  const detail = error.details?.map((d) => d.message).filter(Boolean).join(" ");
  return detail || error.message || fallback;
}

/**
 * Posts JSON and normalises both transport and API failures into one shape, so
 * every caller can render a real message instead of "something went wrong".
 */
export async function sendJson<T>(
  url: string,
  method: "POST" | "PATCH",
  body: unknown,
  init?: { contentType?: string; rawBody?: string },
): Promise<SendResult<T>> {
  let response: Response;

  try {
    response = await fetch(url, {
      method,
      headers: { "Content-Type": init?.contentType ?? "application/json" },
      body: init?.rawBody ?? JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const fallback =
      response.status === 403
        ? "Your role does not permit this action."
        : response.status === 401
          ? "Your session has expired. Sign in again."
          : "That did not work.";
    return { ok: false, message: readMessage(payload as ApiFailure | null, fallback) };
  }

  return { ok: true, data: (payload as { data: T }).data };
}
