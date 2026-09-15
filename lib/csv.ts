import Papa from "papaparse";
import { z } from "zod";

/**
 * CSV bulk import for feedback.
 *
 * Sentiment and themes are deliberately not accepted from the file. They are
 * filled in later by the classification pipeline, so an import that set them
 * would be overwritten and would misrepresent where the values came from.
 */

export const FEEDBACK_CSV_COLUMNS = ["content", "channel", "customer_label", "created_at"] as const;
export const REQUIRED_CSV_COLUMNS = ["content", "channel"] as const;

/** A single import is bounded so one file cannot tie up the database. */
export const CSV_ROW_LIMIT = 2000;
export const CSV_MAX_CHARS = 1_000_000;

/** Offered as a download in the UI so the expected shape is never guesswork. */
export const FEEDBACK_CSV_TEMPLATE = [
  "content,channel,customer_label,created_at",
  '"Exports time out on our largest account.",Support ticket,Acme Retail,2026-09-01',
  '"Love the new dashboard, it is genuinely fast now.",NPS survey,Bluepeak Health,2026-09-04',
  '"The mobile app logs me out every single day.",App store review,,2026-09-08',
].join("\n");

export type CsvFeedbackRow = {
  content: string;
  channel: string;
  customerLabel: string | null;
  createdAt: Date | null;
};

export type CsvRowError = {
  /** Line number in the file, counting the header as line 1. */
  row: number;
  message: string;
};

export type CsvParseResult = {
  rows: CsvFeedbackRow[];
  errors: CsvRowError[];
  /** Data rows seen in the file, valid or not. Blank lines are not counted. */
  totalRows: number;
  /** Required columns the header did not contain. */
  missingColumns: string[];
};

/** `Customer Label`, `customer label` and `customer_label` all mean the same column. */
function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;

const optionalText = (max: number, column: string) =>
  z
    .string()
    .trim()
    .max(max, `${column} is longer than ${max} characters.`)
    .optional()
    .transform((value) => (value ? value : null));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : null))
  .refine((value) => value === null || !Number.isNaN(Date.parse(value)), {
    message: "created_at is not a date we can read. Use YYYY-MM-DD or a full ISO timestamp.",
  })
  .transform((value) => (value === null ? null : new Date(value)))
  .refine((value) => value === null || value.getTime() <= Date.now() + MAX_FUTURE_MS, {
    message: "created_at is in the future.",
  });

/** Every row from a file is untrusted input and goes through this before it reaches the database. */
export const csvRowSchema = z
  .object({
    content: z
      .string()
      .trim()
      .min(1, "content is required.")
      .max(5000, "content is longer than 5000 characters."),
    channel: z
      .string()
      .trim()
      .min(1, "channel is required.")
      .max(80, "channel is longer than 80 characters."),
    customer_label: optionalText(120, "customer_label"),
    created_at: optionalDate,
  })
  .transform(
    (row): CsvFeedbackRow => ({
      content: row.content,
      channel: row.channel,
      customerLabel: row.customer_label,
      createdAt: row.created_at,
    }),
  );

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join(" ");
}

type RawRow = Record<string, string | undefined>;

function isBlank(row: RawRow): boolean {
  return Object.values(row).every((value) => (value ?? "").trim() === "");
}

/**
 * Parses and validates a whole file. Valid rows and per-row failures come back
 * together so a partial import can report exactly which lines were rejected and why.
 */
export function parseFeedbackCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<RawRow>(text, {
    header: true,
    skipEmptyLines: false,
    transformHeader: normaliseHeader,
  });

  const fields = parsed.meta.fields ?? [];
  const missingColumns = REQUIRED_CSV_COLUMNS.filter((column) => !fields.includes(column));
  if (missingColumns.length > 0) {
    return { rows: [], errors: [], totalRows: 0, missingColumns: [...missingColumns] };
  }

  const errors: CsvRowError[] = [];

  // Papaparse reports structural problems (ragged rows, unclosed quotes) separately.
  const structural = new Map<number, string>();
  for (const error of parsed.errors) {
    if (typeof error.row === "number") structural.set(error.row, error.message);
  }

  const rows: CsvFeedbackRow[] = [];
  let totalRows = 0;
  let overLimit = false;

  parsed.data.forEach((raw, index) => {
    if (isBlank(raw)) return;

    totalRows += 1;
    // Header occupies line 1, so the first data row is line 2.
    const line = index + 2;

    if (totalRows > CSV_ROW_LIMIT) {
      if (!overLimit) {
        overLimit = true;
        errors.push({
          row: line,
          message: `This file has more than ${CSV_ROW_LIMIT} rows. Split it and import again.`,
        });
      }
      return;
    }

    const structuralError = structural.get(index);
    if (structuralError) {
      errors.push({ row: line, message: structuralError });
      return;
    }

    const result = csvRowSchema.safeParse({
      content: raw.content ?? "",
      channel: raw.channel ?? "",
      customer_label: raw.customer_label ?? "",
      created_at: raw.created_at ?? "",
    });

    if (result.success) {
      rows.push(result.data);
    } else {
      errors.push({ row: line, message: describeIssues(result.error) });
    }
  });

  return { rows, errors, totalRows, missingColumns: [] };
}
