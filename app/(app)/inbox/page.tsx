import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getPrincipal } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { FILTER_KEYS } from "@/app/api/feedback/_constants";
import {
  listFeedback,
  listFilterOptions,
  readFeedbackQuerySafe,
  type FeedbackQuery,
} from "@/app/api/feedback/_query";
import { FilterBar } from "@/components/inbox/filter-bar";
import { FeedbackTable } from "@/components/inbox/feedback-table";
import { Pagination } from "@/components/inbox/pagination";
import { PageHeader } from "../_components/page-header";

/**
 * The inbox.
 *
 * Filters and paging live entirely in the URL, so this page is a pure function of
 * the address bar: a refresh, a back button or a pasted link all land on exactly
 * the same view. Reading goes through the same module the API route uses, so both
 * enforce the same workspace scoping and the same page cap.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** Returns null rather than throwing, so a database problem renders a real error state. */
async function loadInbox(workspaceId: string, query: FeedbackQuery) {
  try {
    const [page, options] = await Promise.all([
      listFeedback(workspaceId, query),
      listFilterOptions(workspaceId),
    ]);
    return { page, options };
  } catch (error) {
    console.error("Inbox failed to load:", error);
    return null;
  }
}

export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const { query, invalid } = readFeedbackQuerySafe(searchParams);
  const canWrite = principal.role !== Role.VIEWER;
  const activeFilterCount = FILTER_KEYS.filter((key) => {
    const value = searchParams[key];
    const first = Array.isArray(value) ? value[0] : value;
    return typeof first === "string" && first.trim() !== "";
  }).length;

  const loaded = await loadInbox(principal.workspaceId, query);

  if (!loaded) {
    return (
      <>
        <PageHeader title="Inbox" description="Search, filter and triage every piece of feedback." />
        <Card>
          <ErrorState
            title="The inbox could not be loaded"
            description="The database did not answer. Refresh the page, and if it keeps happening check the connection settings."
          />
        </Card>
      </>
    );
  }

  const { page, options } = loaded;

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Search, filter and triage every piece of feedback."
        action={
          canWrite ? (
            <Link href="/inbox/ingest">
              <Button>Add feedback</Button>
            </Link>
          ) : undefined
        }
      />

      {invalid ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          Part of that link was not something the inbox understands, so it has been reset to show
          everything.
        </p>
      ) : null}

      <FilterBar options={options} activeFilterCount={activeFilterCount} />

      <Card>
        <FeedbackTable items={page.items} canWrite={canWrite} filtered={activeFilterCount > 0} />
        <Pagination
          page={page.page}
          perPage={page.perPage}
          total={page.total}
          totalPages={page.totalPages}
        />
      </Card>
    </>
  );
}
