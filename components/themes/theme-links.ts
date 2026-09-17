import { FILTER_KEYS } from "@/app/api/feedback/_constants";

/**
 * Where a theme goes when you click it.
 *
 * The inbox already lists feedback, filters it, pages it and triages it, and it
 * already understands `themeId`. So a theme here links into that rather than
 * growing a second list beside it that would drift out of step within a week.
 *
 * Whatever else is filtering this page travels with the link, so clicking
 * "Billing & invoicing" while looking at the last 30 days lands on the last 30
 * days of billing feedback rather than on all of it.
 */
export function inboxHref(themeId: string, filters: Record<string, string>): string {
  const params = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    if (key === "themeId") continue;
    const value = filters[key];
    if (typeof value === "string" && value.trim() !== "") params.set(key, value);
  }

  params.set("themeId", themeId);
  return `/inbox?${params.toString()}`;
}

/** The filters worth carrying between the trends page and the inbox. */
export function carriedFilters(
  searchParams: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const filters: Record<string, string> = {};

  for (const key of FILTER_KEYS) {
    const value = searchParams[key];
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim() !== "") filters[key] = first;
  }

  return filters;
}
