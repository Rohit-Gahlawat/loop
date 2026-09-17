import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getPrincipal } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { FILTER_KEYS, UNCLASSIFIED } from "@/app/api/feedback/_constants";
import { listFilterOptions } from "@/app/api/feedback/_query";
import { loadThemeTrends, type ThemeTrends } from "@/app/api/themes/_trends";
import { readThemeQuerySafe, type ThemeQuery } from "@/app/api/themes/_query";
import { FilterBar } from "@/components/inbox/filter-bar";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartTable } from "@/components/charts/chrome";
import { DateRangePresets } from "@/components/charts/date-range-presets";
import { formatCount, formatPercent } from "@/components/charts/theme";
import { ReclassifyButton } from "@/components/themes/reclassify-button";
import { SpikeSummary } from "@/components/themes/spike-summary";
import { ThemeTable } from "@/components/themes/theme-table";
import { ThemeTrendsChart } from "@/components/themes/theme-trends-chart";
import { WindowPicker } from "@/components/themes/window-picker";
import { carriedFilters } from "@/components/themes/theme-links";
import { PageHeader } from "../_components/page-header";

/**
 * Trends.
 *
 * Which themes the feedback is collecting in, how that has moved, and which of
 * them have grown against the period before. Filters and the comparison window
 * live entirely in the URL, so this page is a pure function of the address bar
 * and a link to a spike shows the recipient the same comparison.
 *
 * Reading goes through the same module the API routes use, so both enforce the
 * same workspace scoping and produce the same numbers. Every count is grouped
 * in Postgres; nothing here is classified, counted or recomputed on render.
 */

const DESCRIPTION = "Which themes are growing, and which are spiking.";

type SearchParams = Record<string, string | string[] | undefined>;

const BUCKET_DESCRIPTION = {
  day: "Items per theme per day.",
  week: "Items per theme per week, starting Monday.",
  month: "Items per theme per month.",
} as const;

/** Returns null rather than throwing, so a database problem renders a real error state. */
async function loadTrends(workspaceId: string, query: ThemeQuery) {
  try {
    const [trends, options] = await Promise.all([
      loadThemeTrends(workspaceId, query, { series: true }),
      listFilterOptions(workspaceId),
    ]);
    return { trends, options };
  } catch (error) {
    console.error("Trends failed to load:", error);
    return null;
  }
}

/**
 * Nothing is tagged yet, which is a different thing from nothing being there.
 * Classification runs on ingest, so a workspace seeded before it shipped sits
 * here until somebody catches it up.
 */
function NotClassifiedYet({
  coverage,
  canWrite,
}: {
  coverage: ThemeTrends["coverage"];
  canWrite: boolean;
}) {
  return (
    <Card>
      <EmptyState
        title="No feedback has been classified yet"
        description={
          coverage.total === 0
            ? "Nothing matches the current filters, so there is nothing to group into themes."
            : `${formatCount(coverage.total)} items are waiting and ${formatCount(coverage.themeCount)} themes are set up. Classification runs on ingest, so anything that arrived before it was switched on needs catching up once.`
        }
        action={
          coverage.total > 0 && canWrite ? (
            <div className="flex flex-col items-center gap-2">
              <ReclassifyButton
                target={{ target: "unclassified" }}
                label="Classify the next few items"
                variant="primary"
                size="md"
              />
              <p className="max-w-md text-sm text-slate-500">
                This classifies a small batch so you can see the result straight away. For the
                whole backlog run scripts/backfill-classification.ts, which paces itself against
                the provider&apos;s rate limit.
              </p>
            </div>
          ) : undefined
        }
      />
    </Card>
  );
}

function CoverageNote({
  coverage,
  filters,
}: {
  coverage: ThemeTrends["coverage"];
  filters: Record<string, string>;
}) {
  if (coverage.unclassified === 0) return null;

  const params = new URLSearchParams(filters);
  params.set("sentiment", UNCLASSIFIED);

  return (
    <p className="text-sm text-slate-500">
      {`${formatCount(coverage.unclassified)} of ${formatCount(coverage.total)} items in this slice are not classified yet, so they are counted in no theme. `}
      <Link href={`/inbox?${params.toString()}`} className="font-medium text-indigo-700 hover:text-indigo-900">
        Read them in the inbox
      </Link>
      .
    </p>
  );
}

export default async function TrendsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { query, invalid } = readThemeQuerySafe(searchParams);
  const canWrite = principal.role !== Role.VIEWER;
  const filters = carriedFilters(searchParams);
  const activeFilterCount = FILTER_KEYS.filter((key) => key in filters).length;

  const loaded = await loadTrends(principal.workspaceId, query);

  if (!loaded) {
    return (
      <>
        <PageHeader title="Trends" description={DESCRIPTION} />
        <Card>
          <ErrorState
            title="Trends could not be loaded"
            description="The database did not answer. Refresh the page, and if it keeps happening check the connection settings."
          />
        </Card>
      </>
    );
  }

  const { trends, options } = loaded;
  const { coverage, series, window } = trends;
  const spiking = trends.themes.filter((theme) => theme.spiking);
  const withItems = trends.themes.filter((theme) => theme.total > 0);

  return (
    <>
      <PageHeader
        title="Trends"
        description={DESCRIPTION}
        action={
          canWrite && coverage.unclassified > 0 && coverage.tagged > 0 ? (
            <ReclassifyButton
              target={{ target: "unclassified" }}
              label="Classify pending items"
            />
          ) : undefined
        }
      />

      {invalid ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Part of that link was not something this page understands, so it has been reset to show
          everything.
        </p>
      ) : null}

      {/* The same filter row the inbox and the dashboard carry, above everything
          it scopes, so one URL means one slice of feedback on all three pages. */}
      <DateRangePresets />
      <WindowPicker />
      <FilterBar options={options} activeFilterCount={activeFilterCount} />

      {coverage.tagged === 0 ? (
        <NotClassifiedYet coverage={coverage} canWrite={canWrite} />
      ) : (
        <div className="space-y-4">
          <section aria-labelledby="spiking-heading" className="space-y-3">
            <h2 id="spiking-heading" className="text-sm font-semibold text-slate-900">
              {`Spiking against the previous ${window.days} days`}
            </h2>

            {!window.rangeCoversWindow ? (
              <Card>
                <CardBody className="text-sm text-slate-500">
                  The selected date range ends before the last {window.days} days began, so no
                  theme can be compared against them.
                </CardBody>
              </Card>
            ) : spiking.length === 0 ? (
              <Card>
                <CardBody className="text-sm text-slate-500">
                  {`Nothing is spiking. No theme has grown enough against the ${window.days} days before to be worth interrupting you for.`}
                </CardBody>
              </Card>
            ) : (
              <SpikeSummary themes={spiking} windowDays={window.days} filters={filters} />
            )}
          </section>

          <ChartCard
            title="Theme volume over time"
            description={series ? BUCKET_DESCRIPTION[series.bucket] : undefined}
            note={
              series?.clamped
                ? "The selected range is far wider than the feedback it contains, so the chart shows only the period that holds items."
                : series?.truncated
                  ? "The selected range is too long to plot in full, so the chart stops early."
                  : undefined
            }
            table={
              series && series.points.length > 0 ? (
                <ChartTable
                  caption="Theme volume over time"
                  columns={[
                    { key: "period", label: "Period" },
                    ...series.themeIds.map((id) => ({
                      key: id,
                      label: trends.themes.find((theme) => theme.id === id)?.name ?? "Theme",
                      numeric: true,
                    })),
                  ]}
                  rows={series.points.map((point) => ({
                    key: point.bucketStart,
                    cells: [
                      point.fullLabel,
                      ...series.themeIds.map((id) => formatCount(point.counts[id] ?? 0)),
                    ],
                  }))}
                />
              ) : undefined
            }
          >
            {series ? (
              <ThemeTrendsChart series={series} themes={trends.themes} />
            ) : (
              <EmptyState
                title="Nothing to plot yet"
                description="No themed feedback falls inside the current filters."
              />
            )}
          </ChartCard>

          {/* A Card rather than a ChartCard, so the table runs edge to edge the
              way the inbox's does instead of sitting inside chart padding. */}
          <Card>
            <CardHeader
              title="All themes"
              description={`${formatCount(withItems.length)} of ${formatCount(coverage.themeCount)} themes have feedback in this slice. Click a theme to read the items behind it.`}
            />
            <ThemeTable
              themes={trends.themes}
              windowDays={window.days}
              filters={filters}
              canWrite={canWrite}
              tagged={coverage.tagged}
            />
            {coverage.unclassified > 0 ? (
              <div className="border-t border-slate-200 px-5 py-3">
                <CoverageNote coverage={coverage} filters={filters} />
              </div>
            ) : null}
          </Card>

          <p className="text-sm text-slate-500">
            {`${formatCount(coverage.tagged)} of ${formatCount(coverage.classified)} classified items carry at least one theme` +
              (coverage.classified > 0
                ? `, ${formatPercent(coverage.tagged / coverage.classified)} of them.`
                : ".")}
          </p>
        </div>
      )}
    </>
  );
}
