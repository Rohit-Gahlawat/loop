/**
 * Pulling a JSON object out of a model reply.
 *
 * The provider honours the chat-completions shape but is not strict about
 * returning bare JSON. A reply can arrive fenced in triple backticks, prefixed
 * with a sentence of prose, or followed by a closing remark. All three are the
 * model being conversational rather than the model being wrong, so the JSON is
 * recovered from what came back instead of spending another request asking for
 * the same answer again.
 *
 * Anything that is genuinely not JSON raises `ModelFormatError`, which the
 * caller treats as a parse failure: one more attempt, then manual review.
 */

/** A reply that could not be read as JSON. Distinct from a transport failure. */
export class ModelFormatError extends Error {
  constructor(message: string, readonly sample?: string) {
    super(message);
    this.name = "ModelFormatError";
  }
}

/**
 * Removes markdown fences. Both the opening fence with its optional language
 * tag and the closing fence are dropped, and a reply that fences only part of
 * itself still leaves its JSON behind for the scanner below.
 */
function stripFences(raw: string): string {
  return raw
    .replace(/```[a-zA-Z0-9_-]*\s*\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

/**
 * The first balanced object or array in the text.
 *
 * Counting brackets rather than matching the last one in the string means a
 * trailing "Let me know if you need anything else." cannot corrupt the slice.
 * Characters inside a JSON string are skipped, so a brace in the feedback text
 * the model is quoting back does not shift the depth.
 */
function findBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opener) depth += 1;
    else if (char === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

/** Keeps a short, safe excerpt for the log when a reply cannot be read. */
function sample(raw: string): string {
  return raw.trim().slice(0, 200);
}

/**
 * Reads the JSON value out of a model reply. The result is still untyped: every
 * caller passes it through Zod before a single field of it is believed.
 */
export function extractJson(raw: string): unknown {
  if (raw.trim() === "") {
    throw new ModelFormatError("The model returned an empty reply.");
  }

  const candidate = findBalanced(stripFences(raw));
  if (candidate === null) {
    throw new ModelFormatError("The model reply contained no JSON object.", sample(raw));
  }

  try {
    return JSON.parse(candidate);
  } catch {
    throw new ModelFormatError("The model reply was not valid JSON.", sample(candidate));
  }
}
