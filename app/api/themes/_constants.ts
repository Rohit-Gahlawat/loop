/**
 * Values shared by the themes API and the trends UI.
 *
 * Deliberately free of any database import, in the same spirit as
 * `app/api/feedback/_constants.ts`: client components need these at runtime,
 * and pulling in `_query.ts` would drag Prisma into the browser bundle.
 */

/** Comparison windows offered as buttons, so the set is closed. */
export const WINDOWS = [7, 14, 30] as const;

export type WindowDays = (typeof WINDOWS)[number];

export const DEFAULT_WINDOW_DAYS: WindowDays = 14;

/** The most items one re-classify request will take on. */
export const MAX_RECLASSIFY_ITEMS = 25;
export const DEFAULT_RECLASSIFY_LIMIT = 10;
