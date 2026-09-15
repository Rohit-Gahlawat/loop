import { NextResponse } from "next/server";
import { ZodError } from "zod";

/** Thrown anywhere inside a route handler. Converted to a JSON response by `handler`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const unauthorized = (m = "You must be signed in.") =>
  new ApiError(401, "UNAUTHORIZED", m);
export const forbidden = (m = "Your role does not permit this action.") =>
  new ApiError(403, "FORBIDDEN", m);
export const notFound = (m = "Not found.") => new ApiError(404, "NOT_FOUND", m);
export const badRequest = (m: string, details?: unknown) =>
  new ApiError(400, "BAD_REQUEST", m, details);

/** Success envelope. Every route returns `{ data }` on success. */
export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

function toErrorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields were invalid.",
          details: error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
      },
      { status: 400 },
    );
  }

  console.error("Unhandled route error:", error);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Something went wrong." } },
    { status: 500 },
  );
}

/**
 * Wraps a route handler so thrown ApiError and ZodError become clean JSON.
 * Every route in this app is wrapped in this.
 */
export function handler<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** Reads and validates a JSON body. Throws ZodError, which `handler` turns into a 400. */
export async function parseJson<T>(req: Request, schema: { parse: (v: unknown) => T }) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(body);
}
