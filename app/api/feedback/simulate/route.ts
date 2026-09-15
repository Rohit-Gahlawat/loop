import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handler, ok, parseJson } from "@/lib/api";
import { requireWrite } from "@/lib/auth";
import { SIMULATED_SOURCES, buildSimulatedBatch } from "../_simulate";
import type { SimulateResult, SimulatedSourceSummary } from "../_constants";
import { startProcessing } from "../_process";

const simulateSchema = z.object({
  source: z.string().trim().min(1, "Choose a channel to simulate."),
  count: z.coerce.number().int().min(1).max(25).default(8),
});

/**
 * POST /api/feedback/simulate
 * Stands in for a real channel integration so a demo can show feedback arriving.
 * Same permissions and same pipeline call as every other ingestion path.
 */
export const POST = handler(async (req) => {
  const { workspaceId } = await requireWrite();
  const input = await parseJson(req, simulateSchema);

  const source = SIMULATED_SOURCES.find((candidate) => candidate.id === input.source);
  if (!source) {
    throw badRequest(
      `Unknown channel. Choose one of: ${SIMULATED_SOURCES.map((s) => s.id).join(", ")}.`,
    );
  }

  const batch = buildSimulatedBatch(source, input.count);

  const created = await prisma.feedback.createManyAndReturn({
    data: batch.map((row) => ({ ...row, workspaceId })),
    select: { id: true },
  });

  startProcessing(
    created.map((row) => row.id),
    workspaceId,
  );

  const result: SimulateResult = {
    created: created.length,
    channel: source.channel,
    source: source.id,
  };

  return ok(result, 201);
});

/** Lets the UI render a button per simulated integration without hardcoding the list. */
export const GET = handler(async () => {
  await requireWrite();

  const sources: SimulatedSourceSummary[] = SIMULATED_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    description: source.description,
    channel: source.channel,
  }));

  return ok(sources);
});
