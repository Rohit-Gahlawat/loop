import { z } from "zod";
import { embeddingCoverage, embedQuery, type EmbeddingCoverage } from "@/lib/search/embed";
import { completeJson } from "@/lib/search/model";
import {
  DEFAULT_TOP_K,
  MAX_TOP_K,
  searchSimilar,
  type RetrievedFeedback,
} from "@/lib/search/retrieve";

/**
 * Ask LOOP: retrieve first, then answer from what was retrieved.
 *
 * The one rule this file exists to enforce is that the reader can check the
 * answer. Two things make that true. The model is never given feedback from
 * outside the caller's workspace, because retrieval joins through
 * `Feedback.workspaceId`. And the model cannot name a source that does not
 * exist, because it cites by position in the list it was handed, and those
 * positions are resolved back to rows here. A hallucinated "[14]" against a
 * list of ten simply drops out; it can never become a feedback id in the reply.
 */

export const askInputSchema = z.object({
  question: z
    .string({ error: "Type a question first." })
    .trim()
    .min(3, "Type a question first.")
    .max(500, "Keep the question under 500 characters."),
  topK: z.coerce.number().int().min(1).max(MAX_TOP_K).default(DEFAULT_TOP_K).optional(),
});

export type AskInput = z.infer<typeof askInputSchema>;

/** How much of one item is shown to the model. Long enough for any seeded row. */
const MAX_CONTENT_CHARS = 800;

const SYSTEM = [
  "You answer questions about customer feedback for one workspace of a feedback tool.",
  "You are given a question and a numbered list of real feedback items retrieved from that workspace.",
  "",
  "Rules:",
  "1. Use nothing but the numbered items. You have no other knowledge of this product, its customers or its roadmap.",
  "2. If the items do not contain what was asked, set answered to false and say plainly that the feedback does not cover it. Do not guess, and do not answer from general knowledge.",
  "3. Every statement in your answer must be supported by an item you list in sources.",
  "4. sources holds item numbers from the list you were given, nothing else. Never invent a number, an identifier, a customer name or a quote.",
  "5. Quote exactly when you quote, and keep quotes short.",
  "6. Write at most six sentences of plain prose. No markdown, no headings, no bullet points.",
  "",
  'Reply with one JSON object and nothing else: {"answered": true, "answer": "...", "sources": [1, 3]}',
].join("\n");

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function buildPrompt(question: string, items: RetrievedFeedback[]): string {
  const list = items
    .map((item, index) => {
      const content =
        item.content.length > MAX_CONTENT_CHARS
          ? `${item.content.slice(0, MAX_CONTENT_CHARS)}...`
          : item.content;
      const meta = [DATE.format(new Date(item.createdAt)), item.channel, item.customerLabel]
        .filter(Boolean)
        .join(" | ");
      return `[${index + 1}] ${meta}\n${content}`;
    })
    .join("\n\n");

  return `Question: ${question}\n\nFeedback items retrieved from this workspace:\n\n${list}`;
}

/**
 * Numbers are accepted as strings too. A model that writes "sources": ["1"]
 * has still cited item one, and rejecting the whole reply over that would cost
 * a second call for nothing.
 */
const replySchema = z.object({
  answered: z.boolean(),
  answer: z
    .string()
    .trim()
    .min(1)
    .max(4_000)
    .transform((value) => value.replace(/\s+/g, " ").trim()),
  sources: z.array(z.coerce.number()).max(64).default([]),
});

export type AskAnswer = {
  question: string;
  /** True only when the model answered and cited at least one real item. */
  answered: boolean;
  answer: string;
  /** The items the answer rests on. Read back from the database, never from the model. */
  citations: RetrievedFeedback[];
  /** Everything retrieval put in front of the model, so a reader can see what was available. */
  considered: RetrievedFeedback[];
  coverage: EmbeddingCoverage;
  /** True when nothing in the workspace is indexed, so the UI can offer to build it. */
  needsIndex: boolean;
  /** Set when the answer was held back, with the reason. Null when nothing was overridden. */
  note: string | null;
  askedAt: string;
};

const NOT_IN_DATA =
  "The feedback retrieved for this question does not cover it. Nothing here answers it, " +
  "so there is nothing to report rather than something to guess at.";

function emptyAnswer(
  question: string,
  coverage: EmbeddingCoverage,
  answer: string,
  needsIndex: boolean,
): AskAnswer {
  return {
    question,
    answered: false,
    answer,
    citations: [],
    considered: [],
    coverage,
    needsIndex,
    note: null,
    askedAt: new Date().toISOString(),
  };
}

/**
 * Turns the model's list of item numbers into rows.
 *
 * Out-of-range numbers are dropped rather than repaired: a number the model
 * made up points at nothing, and inventing a nearby row for it would be exactly
 * the failure this feature is meant to make impossible.
 */
function resolveCitations(
  sources: number[],
  items: RetrievedFeedback[],
): { citations: RetrievedFeedback[]; invalid: number[] } {
  const citations: RetrievedFeedback[] = [];
  const seen = new Set<string>();
  const invalid: number[] = [];

  for (const source of sources) {
    const index = Math.trunc(source) - 1;
    const item = Number.isInteger(index) ? items[index] : undefined;

    if (!item) {
      invalid.push(source);
      continue;
    }
    if (seen.has(item.id)) continue;

    seen.add(item.id);
    citations.push(item);
  }

  return { citations, invalid };
}

/**
 * Answers one question for one workspace.
 *
 * `workspaceId` comes from the session and is never read from the request body.
 */
export async function answerQuestion(
  workspaceId: string,
  input: AskInput,
): Promise<AskAnswer> {
  const question = input.question;
  const coverage = await embeddingCoverage(workspaceId);

  // Nothing indexed means nothing to ground an answer in, and no reason to spend
  // a model call finding that out.
  if (coverage.embedded === 0) {
    return emptyAnswer(
      question,
      coverage,
      coverage.total === 0
        ? "This workspace has no feedback yet, so there is nothing to search."
        : "None of this workspace's feedback has been indexed for search yet. Build the search index and ask again.",
      coverage.total > 0,
    );
  }

  const vector = await embedQuery(question);
  const considered = await searchSimilar(workspaceId, vector, input.topK ?? DEFAULT_TOP_K);

  if (considered.length === 0) {
    return emptyAnswer(question, coverage, NOT_IN_DATA, false);
  }

  const reply = await completeJson({
    system: SYSTEM,
    prompt: buildPrompt(question, considered),
    schema: replySchema,
    maxTokens: 1_600,
    temperature: 0,
    repairHint:
      'Reply with the JSON object only: {"answered": boolean, "answer": string, "sources": array of item numbers}.',
  });

  const { citations, invalid } = resolveCitations(reply.sources, considered);

  // An answer nobody can check is the failure mode this feature exists to avoid,
  // so a claim with no surviving citation is not shown as an answer.
  if (reply.answered && citations.length === 0) {
    return {
      question,
      answered: false,
      answer: NOT_IN_DATA,
      citations: [],
      considered,
      coverage,
      needsIndex: false,
      note:
        invalid.length > 0
          ? "An answer was drafted but every source it named was outside the retrieved list, so it was not shown."
          : "An answer was drafted but it cited no feedback, so it could not be verified and was not shown.",
      askedAt: new Date().toISOString(),
    };
  }

  return {
    question,
    answered: reply.answered,
    answer: reply.answered ? reply.answer : reply.answer || NOT_IN_DATA,
    citations: reply.answered ? citations : [],
    considered,
    coverage,
    needsIndex: false,
    note:
      reply.answered && invalid.length > 0
        ? "Some sources named by the model were outside the retrieved list and have been dropped."
        : null,
    askedAt: new Date().toISOString(),
  };
}
