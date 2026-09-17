import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getPrincipal } from "@/lib/auth";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { listReports, readReportListQuery } from "@/app/api/reports/_query";
import type { ReportSummary } from "@/app/api/reports/_content";
import { PageHeader } from "../_components/page-header";
import { GeneratePanel } from "./_components/generate-panel";

/**
 * Saved Voice-of-Customer reports.
 *
 * Reading goes through the same module the API route uses, so the page and the
 * route enforce the same workspace scoping. Viewers see every saved report and
 * no generate panel; the route refuses them regardless.
 */

export const dynamic = "force-dynamic";

const DESCRIPTION = "Generate a Voice-of-Customer digest for any period.";

type SearchParams = Record<string, string | string[] | undefined>;

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

function ReportRow({ report }: { report: ReportSummary }) {
  return (
    <li>
      <Link
        href={`/reports/${report.id}`}
        className="block px-5 py-4 transition-colors hover:bg-slate-50"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="text-sm font-semibold text-slate-900">{report.title}</h3>
          <p className="text-xs text-slate-500">
            {RANGE.format(new Date(report.periodStart))} to{" "}
            {RANGE.format(new Date(report.periodEnd))}
          </p>
        </div>
        {report.headline ? (
          <p className="mt-1 text-sm text-slate-600">{report.headline}</p>
        ) : null}
        <p className="mt-1 text-xs text-slate-500">
          {report.total === null ? "Content unreadable" : `${report.total} items`}
          {" · "}
          {report.generatedBy?.name ?? "a removed member"}
          {" · "}
          {STAMP.format(new Date(report.createdAt))}
        </p>
      </Link>
    </li>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const canGenerate = principal.role !== Role.VIEWER;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string") params.set(key, first);
  }

  let page;
  try {
    page = await listReports(principal.workspaceId, readReportListQuery(params));
  } catch (error) {
    console.error("Reports page failed to load:", error);
    return (
      <>
        <PageHeader title="Reports" description={DESCRIPTION} />
        <Card>
          <ErrorState
            title="Reports could not be loaded"
            description="Reload the page. If it keeps happening, the details are in the server log."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Reports" description={DESCRIPTION} />

      <div className="space-y-6">
        {canGenerate ? (
          <GeneratePanel />
        ) : (
          <Card>
            <CardHeader
              title="Generate a report"
              description="Viewers can read every saved report. Ask an admin or analyst to generate a new one."
            />
          </Card>
        )}

        <Card>
          <CardHeader
            title="Saved reports"
            description={
              page.total === 1 ? "1 report saved." : `${page.total} reports saved.`
            }
          />
          {page.items.length === 0 ? (
            <EmptyState
              title="No reports yet"
              description={
                canGenerate
                  ? "Pick a period above and generate the first one."
                  : "Nothing has been generated for this workspace yet."
              }
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {page.items.map((report) => (
                <ReportRow key={report.id} report={report} />
              ))}
            </ul>
          )}
          {page.totalPages > 1 ? (
            <CardBody className="flex items-center justify-between border-t border-slate-200 text-sm text-slate-600">
              <span>
                Page {page.page} of {page.totalPages}
              </span>
              <span className="flex gap-3">
                {page.page > 1 ? (
                  <Link className="text-indigo-700" href={`/reports?page=${page.page - 1}`}>
                    Previous
                  </Link>
                ) : null}
                {page.page < page.totalPages ? (
                  <Link className="text-indigo-700" href={`/reports?page=${page.page + 1}`}>
                    Next
                  </Link>
                ) : null}
              </span>
            </CardBody>
          ) : null}
        </Card>
      </div>
    </>
  );
}
