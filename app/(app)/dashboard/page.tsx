import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { getPrincipal } from "@/lib/auth";
import { FILTER_KEYS } from "@/app/api/feedback/_constants";
import { listFilterOptions } from "@/app/api/feedback/_query";
import { loadInsights, type DashboardInsights } from "@/app/api/insights/_aggregate";
import { readInsightsQuerySafe, type InsightsQuery } from "@/app/api/insights/_query";
import { FilterBar } from "@/components/inbox/filter-bar";
import { SENTIMENT_LABELS } from "@/components/inbox/tags";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartTable } from "@/components/charts/chrome";
import { DateRangePresets } from "@/components/charts/date-range-presets";
import { SentimentChart } from "@/components/charts/sentiment-chart";
import { StatCard } from "@/components/charts/stat-card";
import { ThemesChart } from "@/components/charts/themes-chart";
import { VolumeChart } from "@/components/charts/volume-chart";
import { formatCount, formatItems, formatPercent } from "@/components/charts/theme";
import { PageHeader } from "../_components/page-header";

/**
 * The dashboard.
 *
 * Filters live entirely in the URL, exactly as the inbox's do, and this page
 * reuses the inbox's own filter bar rather than growing a second one that drifts.
 * A link copied from here filters the inbox to the same slice of feedback, and
 * back again. Every tile and every chart on this page is drawn from one
 * workspace-scoped read taken at one instant, so no two of them can disagree.
 *
 * Aggregation happens on the server and only plain serialisable numbers cross
 * into the client components that draw the charts.
 */

const DESCRIPTION = "The shape of your feedback at a glance.";

type SearchParams = Record<string, string | string[] | undefined>;

/** Returns null rather than throwing, so a database problem renders a real error state. */
async function loadDashboard(workspaceId: string, query: InsightsQuery) {
  try {
    const [insights, options] = await Promise.all([
      loadInsights(workspaceId, query),
      listFilterOptions(workspaceId),
    ]);
    return { insights, options };
  } catch (error) {
    console.error("Dashboard failed to load:", error);
    return null;
  }
}

const BUCKET_DESCRIPTION = {
  day: "Items per day.",
  week: "Items per week, starting Monday.",
  month: "Items per month.",
} as const;

function StatRow({ stats }: { stats: DashboardInsights["stats"] }) {
  const change = stats.newThisWeek - stats.previousWeek;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Total items"
        value={formatCount(stats.total)}
        note={
          stats.total === 0
            ? "Nothing matches the current filters."
            : `${formatCount(stats.unclassified)} of these are not classified yet.`
        }
      />

      {/* An empty denominator is not zero. Saying "0%" here would read as "no
          negative feedback", which is the opposite of what the data supports. */}
      <StatCard
        label="Negative feedback"
        value={
          stats.negativeShare === null ? "Not known yet" : formatPercent(stats.negativeShare)
        }
        unavailable={stats.negativeShare === null}
        note={
          stats.negativeShare === null
            ? stats.total === 0
              ? "There is nothing in this slice to classify."
              : `None of the ${formatCount(stats.total)} items in this slice have been classified, so there is no share to calculate.`
            : `${formatCount(stats.negative)} negative of ${formatItems(stats.classified)} classified.`
        }
      />

      <StatCard
        label="New this week"
        value={formatCount(stats.newThisWeek)}
        delta={
          stats.rangeCoversThisWeek
            ? {
                direction: change > 0 ? "up" : change < 0 ? "down" : "level",
                text:
                  change === 0
                    ? `Level with the ${formatCount(stats.previousWeek)} in the seven days before.`
                    : `${formatCount(Math.abs(change))} ${change > 0 ? "more" : "fewer"} than the seven days before.`,
              }
            : undefined
        }
        note={
          stats.rangeCoversThisWeek
            ? "Arrived in the last seven days, within the current filters."
            : "The selected date range ends before the last seven days began, so nothing can count as new."
        }
      />
    </div>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { query, invalid } = readInsightsQuerySafe(searchParams);
  const activeFilterCount = FILTER_KEYS.filter((key) => {
    const value = searchParams[key];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first.trim() !== "";
  }).length;

  const loaded = await loadDashboard(principal.workspaceId, query);

  if (!loaded) {
    return (
      <>
        <PageHeader title="Dashboard" description={DESCRIPTION} />
        <Card>
          <ErrorState
            title="The dashboard could not be loaded"
            description="The database did not answer. Refresh the page, and if it keeps happening check the connection settings."
          />
        </Card>
      </>
    );
  }

  const { insights, options } = loaded;
  const { stats, volume, sentiment, themes } = insights;

  return (
    <>
      <PageHeader title="Dashboard" description={DESCRIPTION} />

      {invalid ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Part of that link was not something the dashboard understands, so it has been reset to
          show everything.
        </p>
      ) : null}

      {/* One filter row, above everything it scopes. Every tile and chart below
          re-renders against the same slice, so the numbers always agree. */}
      <DateRangePresets />
      <FilterBar options={options} activeFilterCount={activeFilterCount} />

      <div className="space-y-4">
        <StatRow stats={stats} />

        <ChartCard
          title="Feedback volume over time"
          description={BUCKET_DESCRIPTION[volume.bucket]}
          note={
            volume.clamped
              ? "The selected range is far wider than the feedback it contains, so the chart shows only the period that holds items."
              : volume.truncated
                ? "The selected range is too long to plot in full, so the chart stops early."
                : undefined
          }
          table={
            volume.points.length > 0 ? (
              <ChartTable
                caption="Feedback volume over time"
                columns={[
                  { key: "period", label: "Period" },
                  { key: "count", label: "Items", numeric: true },
                ]}
                rows={volume.points.map((point) => ({
                  key: point.bucketStart,
                  cells: [point.fullLabel, formatCount(point.count)],
                }))}
              />
            ) : undefined
          }
        >
          <VolumeChart series={volume} />
        </ChartCard>

        <ChartCard
          title="Sentiment breakdown"
          description="Negative to the left, positive to the right, neutral across the middle."
          note={
            sentiment.unclassified > 0 && sentiment.classified > 0
              ? `${formatCount(sentiment.unclassified)} further ${sentiment.unclassified === 1 ? "item is" : "items are"} not classified yet and are left out of these shares.`
              : undefined
          }
          table={
            sentiment.classified > 0 ? (
              <ChartTable
                caption="Sentiment breakdown"
                columns={[
                  { key: "sentiment", label: "Sentiment" },
                  { key: "count", label: "Items", numeric: true },
                  { key: "share", label: "Share of classified", numeric: true },
                ]}
                rows={[
                  ...sentiment.slices.map((slice) => ({
                    key: slice.key,
                    cells: [
                      SENTIMENT_LABELS[slice.key],
                      formatCount(slice.count),
                      slice.share === null ? "Not known" : formatPercent(slice.share),
                    ],
                  })),
                  {
                    key: "unclassified",
                    cells: [
                      "Not classified yet",
                      formatCount(sentiment.unclassified),
                      "Not counted",
                    ],
                  },
                ]}
              />
            ) : undefined
          }
        >
          <SentimentChart breakdown={sentiment} />
        </ChartCard>

        <ChartCard
          title="Top themes"
          description="How often each theme is attached to an item in this slice. An item can carry several."
          table={
            themes.taggedItems > 0 ? (
              <ChartTable
                caption="Top themes"
                columns={[
                  { key: "theme", label: "Theme" },
                  { key: "count", label: "Items", numeric: true },
                  { key: "share", label: "Share of tagged", numeric: true },
                ]}
                rows={themes.items.map((item) => ({
                  key: item.id,
                  cells: [
                    item.name,
                    formatCount(item.count),
                    item.share === null ? "Not known" : formatPercent(item.share),
                  ],
                }))}
              />
            ) : undefined
          }
        >
          <ThemesChart breakdown={themes} />
        </ChartCard>
      </div>
    </>
  );
}
