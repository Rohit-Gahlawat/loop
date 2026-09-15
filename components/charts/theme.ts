import type { Sentiment } from "@prisma/client";

/**
 * Chart tokens.
 *
 * Every colour a chart paints comes from here, and every one of them is a
 * documented step rather than an eyeballed hex. The categorical slot and the
 * diverging pair were both run through the palette validator against this app's
 * chart surface, which is the white of `components/ui/card.tsx`, and clear the
 * lightness, chroma, colourblind-separation, normal-vision and contrast checks.
 *
 * Deliberately free of any database import so client components can use it
 * without dragging Prisma into the browser bundle, in the same spirit as
 * `app/api/feedback/_constants.ts`.
 */

/** The surface charts are drawn on. Marks are separated by gaps in this colour, never by borders. */
export const CHART_SURFACE = "#ffffff";

/** Chrome. Recessive by design: hairline, solid, one step off the surface. */
export const CHART_GRID = "#e1e0d9";
export const CHART_AXIS = "#c3c2b7";
export const CHART_MUTED = "#898781";
export const CHART_INK = "#52514e";

/**
 * One series, one colour. Volume over time and theme counts are each a single
 * series, so both wear this and neither needs a legend: the card title says what
 * is plotted. Colouring bars by their own value would spend the identity channel
 * re-encoding what bar length already shows.
 */
export const SERIES = "#2a78d6";

/**
 * Sentiment is an ordered scale, not a set of names, so it takes the diverging
 * pair: two hues that read as opposite either side of a neutral middle. Blue and
 * red rather than green and red, which is the classic pairing colourblind
 * readers cannot separate.
 */
export const SENTIMENT_COLORS: Record<Sentiment, string> = {
  NEG: "#e34948",
  NEU: "#898781",
  POS: "#2a78d6",
};

const COUNT = new Intl.NumberFormat("en-GB");
const COMPACT = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

/** Grouped up to five figures, compact beyond, so a stat tile never wraps. */
export function formatCount(value: number): string {
  return value >= 100_000 ? COMPACT.format(value) : COUNT.format(value);
}

/** Whole percentages, except below one percent where rounding to zero would lie. */
export function formatPercent(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

export function formatItems(count: number): string {
  return `${formatCount(count)} ${count === 1 ? "item" : "items"}`;
}
