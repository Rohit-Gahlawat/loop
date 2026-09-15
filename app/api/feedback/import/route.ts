import { z } from "zod";
import { prisma } from "@/lib/db";
import { badRequest, handler, ok } from "@/lib/api";
import { requireWrite } from "@/lib/auth";
import { CSV_MAX_CHARS, REQUIRED_CSV_COLUMNS, parseFeedbackCsv } from "@/lib/csv";
import type { ImportResult } from "../_constants";
import { startProcessing } from "../_process";

/** Long error lists are trimmed so one bad file cannot return a huge payload. */
const MAX_REPORTED_ERRORS = 100;

const bodySchema = z.object({
  csv: z
    .string()
    .min(1, "The file is empty.")
    .max(CSV_MAX_CHARS, "That file is too large. Split it and import again."),
});

const rawCsvSchema = bodySchema.shape.csv;

/**
 * Accepts either `{ "csv": "..." }` as JSON, which is what the browser sends
 * after reading the file, or a raw `text/csv` body, which is what curl sends
 * with `--data-binary @file.csv`.
 */
async function readCsv(req: Request): Promise<string> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    return rawCsvSchema.parse(await req.text());
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Send the file as JSON { csv } or with Content-Type: text/csv.");
  }
  return bodySchema.parse(body).csv;
}

/**
 * POST /api/feedback/import
 * Bulk CSV ingestion. Valid rows are imported and invalid rows are reported with
 * their line number and reason, so a partly broken file still gets the good rows in.
 */
export const POST = handler(async (req) => {
  const { workspaceId } = await requireWrite();
  const csv = await readCsv(req);

  const { rows, errors, totalRows, missingColumns } = parseFeedbackCsv(csv);

  if (missingColumns.length > 0) {
    throw badRequest(
      `The file is missing ${missingColumns.length === 1 ? "a required column" : "required columns"}: ${missingColumns.join(", ")}. Every file needs ${REQUIRED_CSV_COLUMNS.join(" and ")}.`,
    );
  }

  if (totalRows === 0) {
    throw badRequest("The file has a header but no data rows.");
  }

  let imported = 0;

  if (rows.length > 0) {
    const created = await prisma.feedback.createManyAndReturn({
      data: rows.map((row) => ({
        content: row.content,
        channel: row.channel,
        customerLabel: row.customerLabel,
        // A null createdAt falls back to the column default of now().
        ...(row.createdAt ? { createdAt: row.createdAt } : {}),
        sourceRef: "CSV",
        workspaceId,
      })),
      select: { id: true },
    });

    imported = created.length;
    startProcessing(
      created.map((row) => row.id),
      workspaceId,
    );
  }

  const result: ImportResult = {
    imported,
    failed: errors.length,
    totalRows,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    errorsTruncated: errors.length > MAX_REPORTED_ERRORS,
  };

  return ok(result, imported > 0 ? 201 : 200);
});
