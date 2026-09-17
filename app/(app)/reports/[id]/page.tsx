import Link from "next/link";
import { redirect } from "next/navigation";
import { getPrincipal } from "@/lib/auth";
import { ApiError } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import { getReport } from "@/app/api/reports/_query";
import type {
  ReportContent,
  ReportDetail,
  ReportQuote,
  SentimentKey,
} from "@/app/api/reports/_content";
import { PrintButton } from "./_components/print-button";

/**
 * One Voice-of-Customer report, laid out to be read on screen and printed.
 *
 * Every figure on this page comes from `content.stats`, which was counted in
 * SQL when the report was generated. The prose in `content.narrative` is
 * printed as prose and never as a number. Where a section has no data, it says
 * so; nothing is filled in to make the page look complete.
 */

export const dynamic = "force-dynamic";

const RANGE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const STAMP = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

const SENTIMENT_LABEL: Record<SentimentKey, string> = {
  NEG: "Negative",
  NEU: "Neutral",
  POS: "Positive",
};

const SENTIMENT_TONE: Record<SentimentKey, "negative" | "neutral" | "positive"> = {
  NEG: "negative",
  NEU: "neutral",
  POS: "positive",
};

function day(value: string): string {
  return RANGE.format(new Date(`${value}T00:00:00.000Z`));
}

function percent(share: number | null): string {
  return share === null ? "n/a" : `${(share * 100).toFixed(1)}%`;
}

/** Percentage points, signed, because a share moving is not a percentage change. */
function points(value: number | null): string {
  if (value === null) return "n/a";
  const rounded = value.toFixed(1);
  return `${value > 0 ? "+" : ""}${rounded} pts`;
}

function change(value: number | null): string {
  if (value === null) return "no comparison";
  return `${value > 0 ? "+" : ""}${value.toFixed(0)}% against the previous period`;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="report-block">
      <CardHeader title={title} description={description} />
      {children}
    </Card>
  );
}

function Prose({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="text-sm leading-relaxed text-slate-700">{text}</p>;
}

/** A plain bar row. Divs rather than a chart library, so it prints as it renders. */
function VolumeBars({
  series,
  bucket,
}: {
  series: ReportContent["stats"]["volume"]["series"];
  bucket: string;
}) {
  const max = series.reduce((highest, point) => Math.max(highest, point.count), 0);
  if (series.length === 0 || max === 0) return null;

  return (
    <div>
      <div className="flex h-24 items-end gap-px" aria-hidden>
        {series.map((point) => (
          <div
            key={point.bucketStart}
            className="report-bar flex-1 rounded-t-sm bg-indigo-500"
            style={{ height: `${Math.max(2, (point.count / max) * 100)}%` }}
            title={`${point.label}: ${point.count}`}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-slate-500">
        <span>{series[0]?.label}</span>
        <span>
          {series.length} {bucket === "day" ? "days" : `${bucket}s`}, peak {max}
        </span>
        <span>{series[series.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function Quote({ quote }: { quote: ReportQuote }) {
  return (
    <figure className="report-block rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <blockquote className="text-sm text-slate-800">{quote.content}</blockquote>
      <figcaption className="mt-2 text-xs text-slate-500">
        {quote.channel}
        {quote.customerLabel ? ` · ${quote.customerLabel}` : ""}
        {" · "}
        {RANGE.format(new Date(quote.createdAt))}
        {quote.sentiment ? ` · ${SENTIMENT_LABEL[quote.sentiment]}` : ""}
        <span className="ml-2 font-mono text-[11px] text-slate-400">{quote.id}</span>
      </figcaption>
    </figure>
  );
}

function ReportBody({ report }: { report: ReportDetail }) {
  const { content } = report;
  const { stats, narrative, period } = content;

  return (
    <div className="space-y-6">
      <Card className="report-block">
        <CardBody className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {report.title}
          </h1>
          <p className="text-sm text-slate-600">
            {day(period.from)} to {day(period.to)}, compared with {day(period.previousFrom)}{" "}
            to {day(period.previousTo)}.
          </p>
          <p className="text-xs text-slate-500">
            Generated by {report.generatedBy?.name ?? "a removed member"} on{" "}
            {STAMP.format(new Date(report.createdAt))}.
          </p>
          {narrative ? (
            <p className="pt-2 text-base font-medium text-slate-900">{narrative.headline}</p>
          ) : null}
        </CardBody>
      </Card>

      {content.narrativeIssue ? (
        <Card className="report-block border-amber-200 bg-amber-50">
          <CardBody>
            <p className="text-sm text-amber-900">{content.narrativeIssue}</p>
          </CardBody>
        </Card>
      ) : null}

      <Section title="Summary">
        <CardBody className="space-y-4">
          <Prose text={narrative?.summary ?? null} />
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Items</dt>
              <dd className="text-lg font-semibold text-slate-900">{stats.volume.total}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Previous period
              </dt>
              <dd className="text-lg font-semibold text-slate-900">
                {stats.volume.previousTotal}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Change</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {stats.volume.changePct === null
                  ? "n/a"
                  : `${stats.volume.changePct > 0 ? "+" : ""}${stats.volume.changePct.toFixed(0)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Classified</dt>
              <dd className="text-lg font-semibold text-slate-900">
                {stats.sentiment.classified} of {stats.volume.total}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Section>

      <Section title="Volume" description={change(stats.volume.changePct)}>
        <CardBody className="space-y-4">
          <VolumeBars series={stats.volume.series} bucket={stats.volume.bucket} />
          {stats.volume.byChannel.length === 0 ? (
            <EmptyState
              title="No feedback in this period"
              description="Nothing arrived through any channel between these dates."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Channel</Th>
                  <Th className="text-right">This period</Th>
                  <Th className="text-right">Previous</Th>
                </tr>
              </thead>
              <tbody>
                {stats.volume.byChannel.map((row) => (
                  <tr key={row.channel}>
                    <Td>{row.channel}</Td>
                    <Td className="text-right tabular-nums">{row.current}</Td>
                    <Td className="text-right tabular-nums text-slate-500">{row.previous}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Section>

      <Section
        title="Top themes"
        description={
          stats.themes.available
            ? `${stats.themes.taggedItems} of ${stats.volume.total} items carry a theme.`
            : undefined
        }
      >
        {stats.themes.available ? (
          <CardBody className="space-y-4">
            <Prose text={narrative?.themes ?? null} />
            <Table>
              <thead>
                <tr>
                  <Th>Theme</Th>
                  <Th className="text-right">This period</Th>
                  <Th className="text-right">Previous</Th>
                  <Th className="text-right">Share of tagged</Th>
                </tr>
              </thead>
              <tbody>
                {stats.themes.items.map((theme) => (
                  <tr key={theme.id}>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden
                          className="report-swatch inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: theme.color }}
                        />
                        {theme.name}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{theme.current}</Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {theme.previous}
                    </Td>
                    <Td className="text-right tabular-nums">{percent(theme.share)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        ) : (
          <EmptyState
            title="No themes to report yet"
            description={`Nothing in this period carries a theme, so there are no top themes to rank. The workspace has ${stats.themes.themeCount} themes defined. This section fills in on its own once classification tags the feedback.`}
          />
        )}
      </Section>

      <Section
        title="Sentiment"
        description={
          stats.sentiment.available
            ? "Shares are of the classified items only, not of everything."
            : undefined
        }
      >
        {stats.sentiment.available ? (
          <CardBody className="space-y-4">
            <Prose text={narrative?.sentiment ?? null} />
            <Table>
              <thead>
                <tr>
                  <Th>Sentiment</Th>
                  <Th className="text-right">Items</Th>
                  <Th className="text-right">Share</Th>
                  <Th className="text-right">Previous share</Th>
                  <Th className="text-right">Shift</Th>
                </tr>
              </thead>
              <tbody>
                {stats.sentiment.slices.map((slice) => (
                  <tr key={slice.key}>
                    <Td>
                      <Badge tone={SENTIMENT_TONE[slice.key]}>
                        {SENTIMENT_LABEL[slice.key]}
                      </Badge>
                    </Td>
                    <Td className="text-right tabular-nums">{slice.current}</Td>
                    <Td className="text-right tabular-nums">{percent(slice.currentShare)}</Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {percent(slice.previousShare)}
                    </Td>
                    <Td className="text-right tabular-nums">{points(slice.shift)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {stats.sentiment.unclassified > 0 ? (
              <p className="text-xs text-slate-500">
                {stats.sentiment.unclassified} items in this period are not classified and are
                excluded from every share above.
              </p>
            ) : null}
          </CardBody>
        ) : (
          <EmptyState
            title="No sentiment to report yet"
            description={`None of the ${stats.volume.total} items in this period has been classified, so there is no distribution and no shift to show. This section fills in on its own once classification runs.`}
          />
        )}
      </Section>

      <Section
        title="Notable quotes"
        description="The longest item from each channel, channels taken in order of volume. Verbatim, with the feedback id beside each one."
      >
        <CardBody className="space-y-3">
          <Prose text={narrative?.quotes ?? null} />
          {stats.quotes.length === 0 ? (
            <EmptyState
              title="No quotes"
              description="There is no feedback in this period to quote."
            />
          ) : (
            stats.quotes.map((quote) => <Quote key={quote.id} quote={quote} />)
          )}
        </CardBody>
      </Section>

      <Section title="Recommended actions">
        {narrative && narrative.actions.length > 0 ? (
          <CardBody>
            <ol className="space-y-3">
              {narrative.actions.map((action, index) => (
                <li key={action.title} className="report-block flex gap-3">
                  <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
                    {index + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{action.title}</p>
                    <p className="text-sm text-slate-600">{action.rationale}</p>
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        ) : (
          <EmptyState
            title="No recommended actions"
            description="The written part of this report could not be produced, so there are no suggested actions. The figures above are unaffected."
          />
        )}
      </Section>

      <Card className="report-block">
        <CardBody>
          <p className="text-xs leading-relaxed text-slate-500">
            Every figure in this report was counted from this workspace&apos;s feedback in the
            database when the report was generated. The written sections were produced
            afterwards by {content.model} from those figures alone, and are checked for
            numbers the data does not contain before being saved.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export default async function ReportPage({ params }: { params: { id: string } }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  let report: ReportDetail;
  try {
    report = await getReport(principal.workspaceId, params.id);
  } catch (error) {
    const missing = error instanceof ApiError && error.status === 404;
    if (!missing) console.error("Report failed to load:", error);

    return (
      <Card>
        <ErrorState
          title={missing ? "That report is not in your workspace" : "The report could not be loaded"}
          description={
            missing
              ? "It may have been deleted, or the link may belong to another workspace."
              : "Reload the page. If it keeps happening, the details are in the server log."
          }
          action={
            <Link className="text-sm font-medium text-indigo-700" href="/reports">
              Back to reports
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <>
      {/*
        Export is the browser's own print dialogue, which needs the application
        chrome out of the way and the cards kept whole across a page break. Kept
        with the page rather than in the global stylesheet, because nothing else
        in the application prints.
      */}
      <style>{`
        @media print {
          body { background: #fff; }
          header, .no-print { display: none !important; }
          main { max-width: none !important; padding: 0 !important; }
          .report-block { break-inside: avoid; box-shadow: none !important; }
          .report-bar, .report-swatch { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
          a[href]::after { content: ""; }
        }
        @page { margin: 16mm; }
      `}</style>

      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href="/reports" className="text-sm font-medium text-indigo-700">
          Back to reports
        </Link>
        <PrintButton />
      </div>

      <ReportBody report={report} />
    </>
  );
}
