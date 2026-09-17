import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, badRequest, handler, notFound, ok, parseJson } from "@/lib/api";
import { requireWrite } from "@/lib/auth";
import { classifyBatch } from "@/lib/ai/classify";
import { DEFAULT_RECLASSIFY_LIMIT, MAX_RECLASSIFY_ITEMS } from "../_constants";

export const dynamic = "force-dynamic";

/**
 * POST /api/themes/reclassify
 * Runs classification again over a bounded set of items, so a wrong sentiment
 * or a badly chosen theme can be corrected without waiting for the next import.
 *
 * Admins and analysts only. A viewer gets a 403 from here, not merely a hidden
 * button, and a signed-out caller gets a 401.
 *
 * Three targets, because there are three ways a person notices a mistake:
 * an item they are looking at, a theme that has collected the wrong items, and
 * the backlog of things the model could not be read for the first time.
 *
 * Bounded on purpose. A model request takes seconds and the free tier allows
 * only a handful a minute, so this route does a page of work and reports what
 * it did. The whole table is the back-fill script's job, not a request's.
 */

/** Beyond this, the work belongs to the back-fill script rather than a request. */
const MAX_ITEMS = MAX_RECLASSIFY_ITEMS;

const limit = z.coerce.number().int().min(1).max(MAX_ITEMS).default(DEFAULT_RECLASSIFY_LIMIT);
const id = z.string().trim().min(1).max(60);

const reclassifySchema = z.discriminatedUnion("target", [
  z.object({
    target: z.literal("items"),
    feedbackIds: z.array(id).min(1, "Name at least one item.").max(MAX_ITEMS),
  }),
  z.object({ target: z.literal("theme"), themeId: id, limit }),
  z.object({ target: z.literal("unclassified"), limit }),
]);

type ReclassifyInput = z.infer<typeof reclassifySchema>;

/**
 * Turns a target into a list of ids, every query filtered by the caller's own
 * workspaceId. An id from another tenant matches nothing here, so it can never
 * reach the classifier.
 */
async function resolveTargets(
  input: ReclassifyInput,
  workspaceId: string,
): Promise<{ ids: string[]; missing: number }> {
  if (input.target === "items") {
    const rows = await prisma.feedback.findMany({
      where: { id: { in: input.feedbackIds }, workspaceId },
      select: { id: true },
    });
    return { ids: rows.map((row) => row.id), missing: input.feedbackIds.length - rows.length };
  }

  if (input.target === "theme") {
    const theme = await prisma.theme.findFirst({
      where: { id: input.themeId, workspaceId },
      select: { id: true },
    });
    if (!theme) throw notFound("That theme is not in your workspace.");

    const rows = await prisma.feedback.findMany({
      where: { workspaceId, themes: { some: { themeId: theme.id } } },
      select: { id: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    });
    return { ids: rows.map((row) => row.id), missing: 0 };
  }

  const rows = await prisma.feedback.findMany({
    where: { workspaceId, classifiedAt: null },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: input.limit,
  });
  return { ids: rows.map((row) => row.id), missing: 0 };
}

export const POST = handler(async (req) => {
  const { workspaceId } = await requireWrite();
  const input = await parseJson(req, reclassifySchema);

  const { ids, missing } = await resolveTargets(input, workspaceId);

  if (ids.length === 0) {
    throw badRequest(
      input.target === "unclassified"
        ? "Every item in this workspace has already been classified."
        : "None of those items are in your workspace.",
    );
  }

  // Naming items or a theme is a correction, so those run again over results
  // that already exist. The backlog target is a catch-up and leaves finished
  // work alone.
  const force = input.target !== "unclassified";

  let outcome;
  try {
    outcome = await classifyBatch(ids, workspaceId, { force, spacingMs: 500 });
  } catch (error) {
    // The provider being down or misconfigured is not this app failing, and a
    // 500 with "Something went wrong" would send somebody to the wrong log.
    console.error("Re-classification could not reach the model provider:", error);
    throw new ApiError(
      502,
      "MODEL_UNAVAILABLE",
      "The classifier could not be reached. Nothing was changed. Try again in a moment.",
    );
  }

  return ok({
    target: input.target,
    requested: outcome.requested,
    /** Ids that are not in this workspace, or no longer exist. */
    notFound: missing,
    classified: outcome.classified,
    skipped: outcome.skipped,
    needsReview: outcome.needsReview,
    newThemes: outcome.newThemes,
    modelCalls: outcome.modelCalls,
    /** The model's own one-line reasons, so a correction can be judged on sight. */
    notes: outcome.notes,
  });
});
