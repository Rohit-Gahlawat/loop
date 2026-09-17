import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { formatCount, formatPercent } from "@/components/charts/theme";
import { DEFAULT_RECLASSIFY_LIMIT } from "@/app/api/themes/_constants";
import type { ThemeTrend } from "@/app/api/themes/_trends";
import { confidenceLabel, describeChange, shortChange } from "./theme-change";
import { inboxHref } from "./theme-links";
import { ReclassifyButton } from "./reclassify-button";

/**
 * Every theme in the workspace with the number of items behind it.
 *
 * The name is the link. Clicking it opens the inbox filtered to that theme,
 * carrying whatever else is filtering this page, so the count and the list can
 * never disagree about which items they mean.
 *
 * A theme with nothing attached is still listed, at zero. Hiding it would make
 * a theme that has gone quiet look like a theme that was never set up.
 */

/** Re-classifying a theme is a model call per handful of items, so it is bounded. */
const RECLASSIFY_LIMIT = DEFAULT_RECLASSIFY_LIMIT;

export function ThemeTable({
  themes,
  windowDays,
  filters,
  canWrite,
  tagged,
}: {
  themes: ThemeTrend[];
  windowDays: number;
  filters: Record<string, string>;
  canWrite: boolean;
  tagged: number;
}) {
  if (themes.length === 0) {
    return (
      <EmptyState
        title="This workspace has no themes"
        description="Themes appear here as feedback is classified, and the classifier reuses them from then on."
      />
    );
  }

  return (
    <Table>
      <caption className="sr-only">
        {`Themes with their item counts, the last ${windowDays} days against the ${windowDays} before, and how confident the classifier was.`}
      </caption>
      <thead>
        <tr>
          <Th>Theme</Th>
          <Th className="text-right">Items</Th>
          <Th className="text-right">Share</Th>
          <Th className="text-right">{`Last ${windowDays} days`}</Th>
          <Th className="text-right">Change</Th>
          <Th className="text-right">Confidence</Th>
          {canWrite ? <Th className="text-right">Action</Th> : null}
        </tr>
      </thead>
      <tbody>
        {themes.map((theme) => (
          <tr key={theme.id}>
            <Td>
              <Link
                href={inboxHref(theme.id, filters)}
                className="flex items-center gap-2 font-medium text-indigo-700 hover:text-indigo-900"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: theme.color }}
                />
                {theme.name}
              </Link>
              {theme.spiking ? (
                <span className="mt-1 inline-block">
                  <Badge tone={theme.emerging ? "info" : "warning"}>
                    {theme.emerging ? "New" : "Spiking"}
                  </Badge>
                </span>
              ) : null}
            </Td>

            <Td className="text-right tabular-nums">{formatCount(theme.total)}</Td>

            {/* An empty denominator is not zero. Nothing tagged means there is
                no share to take, and printing 0% would read as a real answer. */}
            <Td className="text-right tabular-nums">
              {theme.share === null || tagged === 0 ? (
                <span className="text-slate-400">Not known</span>
              ) : (
                formatPercent(theme.share)
              )}
            </Td>

            <Td className="text-right tabular-nums">{formatCount(theme.current)}</Td>

            <Td className="text-right tabular-nums">
              <span title={describeChange(theme, windowDays)}>{shortChange(theme)}</span>
            </Td>

            <Td className="text-right tabular-nums">
              {theme.averageConfidence === null ? (
                <span className="text-slate-400">{confidenceLabel(null)}</span>
              ) : (
                confidenceLabel(theme.averageConfidence)
              )}
            </Td>

            {canWrite ? (
              <Td className="text-right">
                <div className="flex justify-end">
                  {theme.total === 0 ? (
                    <span className="text-xs text-slate-400">Nothing to re-check</span>
                  ) : (
                    <ReclassifyButton
                      target={{ target: "theme", themeId: theme.id, limit: RECLASSIFY_LIMIT }}
                      label="Re-classify"
                      pendingLabel="Re-classifying"
                    />
                  )}
                </div>
              </Td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
