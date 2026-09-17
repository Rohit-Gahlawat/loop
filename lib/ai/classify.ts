import { Sentiment } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { extractJson, ModelFormatError } from "./json";
import { complete } from "./provider";
import { sleep, withProviderRetry } from "./retry";

/**
 * Assigns sentiment, sentiment score, feature area and themes to feedback.
 * Called once per item on ingest. Results are written to the record so nothing
 * is recomputed on read.
 *
 * Three rules shape everything below.
 *
 * Classify once. The pipeline calls this after ingestion and the answer is
 * stored on the row, so a page render never waits on a model. An item that
 * already carries `classifiedAt` is skipped unless the caller explicitly asks
 * for it again, which is what makes the back-fill safe to re-run.
 *
 * Send the workspace's theme names with every request. Without them the model
 * invents "Slow performance", then "Performance issues", then "Speed", and the
 * workspace ends up with three names for one theme. With them it reuses what is
 * already there and only proposes a new name when nothing fits.
 *
 * Never save a guess. The reply is pulled out of whatever wrapping it arrives
 * in, validated with Zod, and only then written. A reply that cannot be read is
 * retried once; if that fails too, the item is left unclassified for a human
 * rather than written as garbage or dropped.
 */

/** Items per model request. Small enough that a reply is never truncated. */
const BATCH_SIZE = 8;

/** More than this and a theme list stops being a summary. */
const MAX_THEMES_PER_ITEM = 3;

const THEME_NAME_MAX = 60;
const FEATURE_AREA_MAX = 60;

/** Long enough for any real piece of feedback, short enough to bound the prompt. */
const MAX_CONTENT_CHARS = 1_200;

/** Pause between requests. The back-fill raises it to sit inside a free tier. */
const DEFAULT_SPACING_MS = 1_000;

/**
 * How long one request may take before it is abandoned and asked again. Well
 * clear of the slowest replies observed, which run to tens of seconds when the
 * provider is busy.
 */
const REQUEST_TIMEOUT_MS = 90_000;

/**
 * The reply budget.
 *
 * Gemini reasons before it answers and charges that reasoning against
 * `max_tokens`, so a budget sized for the JSON alone comes back empty with a
 * finish reason of "length". This leaves room for both.
 */
const BASE_OUTPUT_TOKENS = 1_600;
const PER_ITEM_OUTPUT_TOKENS = 320;
const MAX_OUTPUT_TOKENS = 8_192;

/**
 * Used only when a model names a theme without saying how sure it is. Writing 1
 * there would record a certainty nobody expressed, so this records the middle
 * of the scale instead, which reads honestly as "unstated".
 */
const UNSTATED_CONFIDENCE = 0.5;

/**
 * Colours for themes the model proposes. The seeded themes bring their own, and
 * a new one picked by name rather than by insertion order keeps its colour
 * stable across a re-run.
 */
const NEW_THEME_COLORS = [
  "#6366f1",
  "#ef4444",
  "#f59e0b",
  "#8b5cf6",
  "#0ea5e9",
  "#10b981",
  "#ec4899",
  "#64748b",
];

/* -------------------------------------------------------------------------- */
/* What the model is allowed to say                                            */
/* -------------------------------------------------------------------------- */

/** Models sometimes quote their numbers. A numeric string is still a number. */
const numberLike = z.union([
  z.number(),
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number),
]);

/** A model that answers 90 means 90 percent, not ninety times certain. */
const confidenceSchema = numberLike
  .transform((value) => (value > 1 && value <= 100 ? value / 100 : value))
  .pipe(z.number().min(0).max(1));

const themeEntrySchema = z.union([
  z.object({
    name: z.string().trim().min(1).max(THEME_NAME_MAX),
    confidence: confidenceSchema.optional(),
  }),
  z
    .string()
    .trim()
    .min(1)
    .max(THEME_NAME_MAX)
    .transform((name) => ({ name, confidence: undefined })),
]);

const classifiedItemSchema = z.object({
  ref: z.union([z.number().int().positive(), z.string().regex(/^\d+$/).transform(Number)]),
  sentiment: z.nativeEnum(Sentiment),
  sentimentScore: numberLike.pipe(z.number().min(-1).max(1)),
  themes: z.array(themeEntrySchema).max(8).default([]),
  featureArea: z.string().trim().min(1).max(FEATURE_AREA_MAX),
  rationale: z.string().trim().min(1).max(400),
});

/** The wrapper, or the bare array a model occasionally answers with instead. */
const modelReplySchema = z.union([
  z.object({ items: z.array(classifiedItemSchema) }),
  z.array(classifiedItemSchema).transform((items) => ({ items })),
]);

type ClassifiedItem = z.infer<typeof classifiedItemSchema>;

/* -------------------------------------------------------------------------- */
/* Public shapes                                                               */
/* -------------------------------------------------------------------------- */

export type ClassifyOptions = {
  /** Re-classify items that already carry `classifiedAt`. Off by default. */
  force?: boolean;
  /** Items per model request. */
  batchSize?: number;
  /** Pause between model requests, for staying inside a rate limit. */
  spacingMs?: number;
  /** Called after each batch, so a long back-fill can report progress. */
  onProgress?: (progress: ClassificationProgress) => void;
};

export type ClassificationProgress = {
  batch: number;
  batches: number;
  classified: number;
  needsReview: number;
};

/** What a classification run did, for the caller to report rather than guess at. */
export type ClassificationOutcome = {
  /** Ids handed in. */
  requested: number;
  /** Of those, the ones in this workspace that still needed classifying. */
  considered: number;
  /** Already carried `classifiedAt` and were left alone. */
  skipped: number;
  classified: number;
  /**
   * Items the model could not be read for. They keep `classifiedAt` null, so
   * they stay in the inbox's "Unclassified" filter for a human to pick up.
   */
  needsReview: string[];
  /** Theme names created by this run, as opposed to reused. */
  newThemes: string[];
  /** Prompts sent. One per batch, plus one wherever a reply had to be asked for again. */
  modelCalls: number;
  /** Requests the provider refused and that were repeated after a wait. */
  throttledRetries: number;
  /** One line per item, in the order they were classified. Not persisted. */
  notes: ClassificationNote[];
};

/** The model's own account of a decision, so a correction can be judged. */
export type ClassificationNote = {
  feedbackId: string;
  sentiment: Sentiment;
  sentimentScore: number;
  featureArea: string;
  themes: { name: string; confidence: number }[];
  rationale: string;
};

type FeedbackRow = { id: string; content: string; channel: string };
type ThemeRef = { id: string; name: string };

/* -------------------------------------------------------------------------- */
/* Prompt                                                                      */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = [
  "You classify customer feedback for LOOP, a product feedback platform.",
  "You reply with one JSON object and nothing else.",
  "No prose before it, no commentary after it, no markdown fences.",
].join(" ");

const SHAPE_EXAMPLE =
  '{"items":[{"ref":1,"sentiment":"NEG","sentimentScore":-0.6,' +
  '"themes":[{"name":"Performance & speed","confidence":0.9}],' +
  '"featureArea":"List view","rationale":"Filters take seconds to return."}]}';

function buildPrompt(items: FeedbackRow[], themeNames: string[], stricter: boolean): string {
  const themeList =
    themeNames.length > 0
      ? `Themes already used in this workspace. Reuse one of these names exactly whenever it fits:\n${themeNames
          .map((name) => `- ${name}`)
          .join("\n")}`
      : "This workspace has no themes yet, so name the themes you find.";

  const lines = items.map((item, index) => {
    const content = item.content.slice(0, MAX_CONTENT_CHARS).replace(/\s+/g, " ").trim();
    return `${index + 1}. [${item.channel}] ${content}`;
  });

  const rules = [
    "sentiment: POS, NEU or NEG, from the customer's point of view.",
    "sentimentScore: a number from -1 (furious) to 1 (delighted) that agrees with the sentiment.",
    `themes: 1 to ${MAX_THEMES_PER_ITEM} entries. Reuse an existing name exactly when one fits. Propose a new name only when none of them do, and keep it short and general enough to be reused.`,
    "confidence: 0 to 1, how sure you are that the theme applies. Use a lower number when the fit is loose. Do not answer 1 unless it is beyond doubt.",
    "featureArea: a short label for the part of the product involved, four words at most.",
    "rationale: one line, twenty words at most.",
  ];

  const strictNote = stricter
    ? "\nYour previous reply could not be parsed. Reply with the raw JSON object only. Do not wrap it in backticks and do not write anything around it.\n"
    : "";

  return [
    `Classify each of the ${items.length} feedback items below.`,
    "",
    themeList,
    "",
    "Rules:",
    ...rules.map((rule) => `- ${rule}`),
    "",
    "Reply with exactly this shape, one entry per item, where ref is the item number:",
    SHAPE_EXAMPLE,
    strictNote,
    "Items:",
    ...lines,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* Tidying what comes back                                                     */
/* -------------------------------------------------------------------------- */

function normaliseThemeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, THEME_NAME_MAX);
}

/** Stable per name, so re-running a back-fill does not repaint the charts. */
function colorFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
  }
  return NEW_THEME_COLORS[hash % NEW_THEME_COLORS.length];
}

type ResolvedTheme = { name: string; confidence: number };

/**
 * Trims the theme list to something a person would write: real names, no
 * duplicates, and a cap so one item cannot claim every theme in the workspace.
 */
function resolveThemes(entry: ClassifiedItem): ResolvedTheme[] {
  const seen = new Set<string>();
  const themes: ResolvedTheme[] = [];

  for (const theme of entry.themes) {
    const name = normaliseThemeName(theme.name);
    if (name === "") continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    themes.push({
      name,
      // Rounded to two places: the third decimal of a model's own confidence is
      // not information, and a tidy number reads as a judgement rather than a
      // measurement.
      confidence: Math.round((theme.confidence ?? UNSTATED_CONFIDENCE) * 100) / 100,
    });

    if (themes.length === MAX_THEMES_PER_ITEM) break;
  }

  return themes;
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** The workspace's themes, keyed case-insensitively so casing cannot fork a theme. */
async function loadThemes(workspaceId: string): Promise<Map<string, ThemeRef>> {
  const themes = await prisma.theme.findMany({
    where: { workspaceId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return new Map(themes.map((theme) => [theme.name.toLowerCase(), theme]));
}

/**
 * Makes sure every name the batch used exists, then hands back the ids.
 *
 * `Theme` is unique on [workspaceId, name], so this upserts rather than
 * creating: two items in the same batch naming the same new theme, or two
 * ingestion runs racing, both end up pointing at one row instead of failing.
 */
async function ensureThemes(
  names: string[],
  workspaceId: string,
  known: Map<string, ThemeRef>,
  created: Set<string>,
): Promise<void> {
  for (const name of names) {
    const key = name.toLowerCase();
    if (known.has(key)) continue;

    const theme = await prisma.theme.upsert({
      where: { workspaceId_name: { workspaceId, name } },
      create: { workspaceId, name, color: colorFor(name) },
      update: {},
      select: { id: true, name: true },
    });

    known.set(key, theme);
    known.set(theme.name.toLowerCase(), theme);
    created.add(theme.name);
  }
}

/**
 * One item's result, written in a single transaction so a row can never end up
 * carrying last week's themes beside this minute's sentiment.
 *
 * The links are replaced rather than added to, because a re-classification is a
 * correction: the themes it does not name are themes it has withdrawn. Both
 * writes carry `workspaceId`, so even a caller holding an id from elsewhere
 * cannot reach another tenant's row.
 */
async function persist(
  row: FeedbackRow,
  entry: ClassifiedItem,
  themes: ResolvedTheme[],
  known: Map<string, ThemeRef>,
  workspaceId: string,
): Promise<void> {
  const links = themes
    .map((theme) => {
      const match = known.get(theme.name.toLowerCase());
      return match ? { feedbackId: row.id, themeId: match.id, confidence: theme.confidence } : null;
    })
    .filter((link): link is { feedbackId: string; themeId: string; confidence: number } =>
      link !== null,
    );

  await prisma.$transaction([
    prisma.feedbackTheme.deleteMany({ where: { feedbackId: row.id, feedback: { workspaceId } } }),
    prisma.feedbackTheme.createMany({ data: links, skipDuplicates: true }),
    prisma.feedback.updateMany({
      where: { id: row.id, workspaceId },
      data: {
        sentiment: entry.sentiment,
        sentimentScore: entry.sentimentScore,
        featureArea: entry.featureArea.slice(0, FEATURE_AREA_MAX),
        classifiedAt: new Date(),
      },
    }),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Asking                                                                      */
/* -------------------------------------------------------------------------- */

function outputBudget(itemCount: number): number {
  return Math.min(MAX_OUTPUT_TOKENS, BASE_OUTPUT_TOKENS + itemCount * PER_ITEM_OUTPUT_TOKENS);
}

/**
 * A deadline of our own.
 *
 * A request that never comes back would hold the classify step open for as long
 * as the connection stayed alive, and the provider call sets no deadline. The
 * losing side of this race cannot cancel the request underneath it, so that
 * socket is left to close on its own; what matters is that the batch stops
 * waiting. The message says "timed out", which the retry treats as transient
 * and repeats.
 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Model request timed out after ${ms}ms.`)), ms);

    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * One request, read into validated items.
 *
 * Transport failures are retried underneath by `withProviderRetry`, which is a
 * different thing from the parse retry above it: a 429 means ask again later, a
 * reply that is not JSON means ask again differently.
 */
async function requestBatch(
  items: FeedbackRow[],
  themeNames: string[],
  stricter: boolean,
  tally: ClassificationOutcome,
): Promise<ClassifiedItem[]> {
  tally.modelCalls += 1;

  const raw = await withProviderRetry(
    () =>
      withTimeout(
        complete({
          system: SYSTEM_PROMPT,
          prompt: buildPrompt(items, themeNames, stricter),
          maxTokens: outputBudget(items.length),
          temperature: 0,
        }),
        REQUEST_TIMEOUT_MS,
      ),
    {
      label: "classification",
      onRetry: () => {
        tally.throttledRetries += 1;
      },
    },
  );

  return modelReplySchema.parse(extractJson(raw)).items;
}

/** Asks, and on an unreadable reply asks once more with a blunter instruction. */
async function classifyOneBatch(
  items: FeedbackRow[],
  themeNames: string[],
  tally: ClassificationOutcome,
): Promise<ClassifiedItem[] | null> {
  try {
    return await requestBatch(items, themeNames, false, tally);
  } catch (error) {
    if (!(error instanceof ModelFormatError) && !(error instanceof z.ZodError)) throw error;

    console.warn(`Classification reply could not be read, asking once more: ${describe(error)}`);

    try {
      return await requestBatch(items, themeNames, true, tally);
    } catch (retryError) {
      if (!(retryError instanceof ModelFormatError) && !(retryError instanceof z.ZodError)) {
        throw retryError;
      }

      console.error(
        `Classification reply could not be read twice, ${items.length} items left for manual review: ${describe(retryError)}`,
      );
      return null;
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
  }
  if (error instanceof ModelFormatError) {
    return error.sample ? `${error.message} Reply began: ${error.sample}` : error.message;
  }
  return error instanceof Error ? error.message : "Unknown error.";
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export async function classifyBatch(
  feedbackIds: string[],
  workspaceId: string,
  options: ClassifyOptions = {},
): Promise<ClassificationOutcome> {
  const ids = Array.from(new Set(feedbackIds.filter((id) => id !== "")));

  const outcome: ClassificationOutcome = {
    requested: ids.length,
    considered: 0,
    skipped: 0,
    classified: 0,
    needsReview: [],
    newThemes: [],
    modelCalls: 0,
    throttledRetries: 0,
    notes: [],
  };

  if (ids.length === 0) return outcome;

  // Scoped to the workspace in the read itself, so an id from another tenant
  // simply is not found rather than being classified on their behalf.
  const rows = await prisma.feedback.findMany({
    where: {
      id: { in: ids },
      workspaceId,
      ...(options.force ? {} : { classifiedAt: null }),
    },
    select: { id: true, content: true, channel: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const inWorkspace = await prisma.feedback.count({ where: { id: { in: ids }, workspaceId } });

  outcome.considered = rows.length;
  outcome.skipped = inWorkspace - rows.length;

  if (rows.length === 0) return outcome;

  const known = await loadThemes(workspaceId);
  const created = new Set<string>();
  const batches = chunk(rows, options.batchSize ?? BATCH_SIZE);
  const spacing = options.spacingMs ?? DEFAULT_SPACING_MS;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];

    // Sequential, spaced, and never in parallel. The free tier counts requests
    // per minute, and a burst of eight would spend the whole allowance at once.
    if (index > 0 && spacing > 0) await sleep(spacing);

    // The names are re-read from the running map each time, so a theme invented
    // in batch one is offered to batch two instead of being invented again.
    const themeNames = Array.from(new Set(Array.from(known.values(), (theme) => theme.name))).sort();

    const entries = await classifyOneBatch(batch, themeNames, outcome);

    if (entries === null) {
      outcome.needsReview.push(...batch.map((row) => row.id));
      options.onProgress?.({
        batch: index + 1,
        batches: batches.length,
        classified: outcome.classified,
        needsReview: outcome.needsReview.length,
      });
      continue;
    }

    const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
    const resolved = batch.map((row, position) => ({
      row,
      entry: byRef.get(position + 1),
    }));

    // Every new name in the batch is created before anything is linked, so the
    // per-item write stays a short transaction rather than a write that waits
    // on a round trip to create a theme.
    const names = resolved.flatMap(({ entry }) =>
      entry ? resolveThemes(entry).map((theme) => theme.name) : [],
    );
    await ensureThemes(names, workspaceId, known, created);

    for (const { row, entry } of resolved) {
      if (!entry) {
        // The model answered, but not about this item. Better left for a human
        // than filled in from its neighbours.
        outcome.needsReview.push(row.id);
        continue;
      }

      const themes = resolveThemes(entry);

      try {
        await persist(row, entry, themes, known, workspaceId);
      } catch (error) {
        console.error(`Could not save a classification for ${row.id}:`, describe(error));
        outcome.needsReview.push(row.id);
        continue;
      }

      outcome.classified += 1;
      outcome.notes.push({
        feedbackId: row.id,
        sentiment: entry.sentiment,
        sentimentScore: entry.sentimentScore,
        featureArea: entry.featureArea,
        themes,
        rationale: entry.rationale,
      });
    }

    options.onProgress?.({
      batch: index + 1,
      batches: batches.length,
      classified: outcome.classified,
      needsReview: outcome.needsReview.length,
    });
  }

  outcome.newThemes = Array.from(created).sort();
  return outcome;
}
