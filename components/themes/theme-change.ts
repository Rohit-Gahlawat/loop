import type { ThemeTrend } from "@/app/api/themes/_trends";

/**
 * Putting a change into words.
 *
 * A ratio on its own is a poor way to describe a theme: three items becoming
 * six is a doubling and means nothing much. So the wording always carries the
 * counts it came from, and a growth from nothing is called what it is rather
 * than printed as an infinite percentage.
 */

export type ChangeDirection = "up" | "down" | "level";

export function directionOf(theme: ThemeTrend): ChangeDirection {
  if (theme.change > 0) return "up";
  if (theme.change < 0) return "down";
  return "level";
}

const RATIO = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

export function describeChange(theme: ThemeTrend, windowDays: number): string {
  const before = `the ${windowDays} days before`;

  if (theme.previous === 0 && theme.current === 0) return `Nothing in either ${windowDays} day window.`;
  if (theme.previous === 0) {
    return `Nothing in ${before}, so this is new rather than growing.`;
  }
  if (theme.change === 0) {
    return `Level with the ${theme.previous} in ${before}.`;
  }

  const size = Math.abs(theme.change);
  const word = theme.change > 0 ? "more" : "fewer";
  const ratio =
    theme.changeRatio !== null && theme.change > 0
      ? `, ${RATIO.format(theme.changeRatio)} times as many`
      : "";

  return `${size} ${size === 1 ? "item" : "items"} ${word} than the ${theme.previous} in ${before}${ratio}.`;
}

/** Short enough for a table cell, where the long sentence belongs in a tooltip. */
export function shortChange(theme: ThemeTrend): string {
  if (theme.current === 0 && theme.previous === 0) return "None";
  if (theme.change === 0) return "Level";
  return `${theme.change > 0 ? "+" : ""}${theme.change}`;
}

export function confidenceLabel(value: number | null): string {
  if (value === null) return "Not tagged";
  return `${Math.round(value * 100)}%`;
}
