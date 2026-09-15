import { FeedbackStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { handler, notFound, ok, parseJson } from "@/lib/api";
import { requireSession, requireWrite } from "@/lib/auth";
import { feedbackSelect, serialiseFeedback } from "../_query";

type Params = { params: { id: string } };

/**
 * GET /api/feedback/:id
 * Scoped by workspaceId, so guessing an id from another workspace returns 404
 * rather than that workspace's row.
 */
export const GET = handler<Params>(async (_req, { params }) => {
  const { workspaceId } = await requireSession();

  const item = await prisma.feedback.findFirst({
    where: { id: params.id, workspaceId },
    select: feedbackSelect,
  });
  if (!item) throw notFound("That feedback is not in your workspace.");

  return ok(serialiseFeedback(item));
});

const updateStatusSchema = z.object({ status: z.nativeEnum(FeedbackStatus) });

/**
 * PATCH /api/feedback/:id
 * Inline triage: NEW to REVIEWED to ACTIONED. Admins and analysts only.
 */
export const PATCH = handler<Params>(async (req, { params }) => {
  const { workspaceId } = await requireWrite();
  const { status } = await parseJson(req, updateStatusSchema);

  // Checked inside the workspace first, so the update below can never touch
  // another tenant's row even if the id is valid somewhere else.
  const existing = await prisma.feedback.findFirst({
    where: { id: params.id, workspaceId },
    select: { id: true },
  });
  if (!existing) throw notFound("That feedback is not in your workspace.");

  const updated = await prisma.feedback.update({
    where: { id: existing.id },
    data: { status },
    select: feedbackSelect,
  });

  return ok(serialiseFeedback(updated));
});
