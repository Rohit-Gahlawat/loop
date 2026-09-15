import type { CsvRowError } from "@/lib/csv";

/**
 * Values and response shapes shared by the API and the inbox UI.
 *
 * Deliberately free of any database import: client components need these at
 * runtime, and pulling in `_query.ts` would drag Prisma into the browser bundle.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/** Rows the pipeline has not classified yet. Selectable as a sentiment filter. */
export const UNCLASSIFIED = "UNCLASSIFIED";

/** The filter keys that live in the URL, in the order the filter bar shows them. */
export const FILTER_KEYS = ["q", "channel", "sentiment", "themeId", "status", "from", "to"] as const;

/** What `POST /api/feedback/import` reports back: what went in, and what did not. */
export type ImportResult = {
  imported: number;
  failed: number;
  totalRows: number;
  errors: CsvRowError[];
  errorsTruncated: boolean;
};

/** What `POST /api/feedback/simulate` reports back. */
export type SimulateResult = {
  created: number;
  channel: string;
  source: string;
};

/** One simulated integration, as offered to the UI. */
export type SimulatedSourceSummary = {
  id: string;
  label: string;
  description: string;
  channel: string;
};
