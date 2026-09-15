import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, ok, parseJson } from "@/lib/api";
import { requireSession, requireWrite } from "@/lib/auth";
import { feedbackSelect, listFeedback, readFeedbackQuery, serialiseFeedback } from "./_query";
import { startProcessing } from "./_process";

/**
 * GET /api/feedback
 * One page of feedback for the caller's workspace. Filters combine, and the page
 * size is capped, so this can never return the whole table.
 */
export const GET = handler(async (req) => {
  const { workspaceId } = await requireSession();
  const query = readFeedbackQuery(new URL(req.url).searchParams);

  return ok(await listFeedback(workspaceId, query));
});

const createFeedbackSchema = z.object({
  content: z
    .string({ error: "Feedback content is required." })
    .trim()
    .min(1, "Feedback content is required.")
    .max(5000, "Keep feedback under 5000 characters."),
  channel: z
    .string({ error: "Choose a channel." })
    .trim()
    .min(1, "Choose a channel.")
    .max(80, "Keep the channel name under 80 characters."),
  customerLabel: z
    .string()
    .trim()
    .max(120, "Keep the customer label under 120 characters.")
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * POST /api/feedback
 * Single-entry ingestion. Admins and analysts only; viewers get a 403 here, not
 * merely a hidden button. Sentiment and themes are left empty for the pipeline.
 */
export const POST = handler(async (req) => {
  const { workspaceId } = await requireWrite();
  const input = await parseJson(req, createFeedbackSchema);

  const created = await prisma.feedback.create({
    data: {
      content: input.content,
      channel: input.channel,
      customerLabel: input.customerLabel,
      sourceRef: "MANUAL",
      workspaceId,
    },
    select: feedbackSelect,
  });

  startProcessing([created.id], workspaceId);

  return ok(serialiseFeedback(created), 201);
});
