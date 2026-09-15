import Link from "next/link";
import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getPrincipal } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import {
  CSV_MAX_CHARS,
  CSV_ROW_LIMIT,
  FEEDBACK_CSV_COLUMNS,
  FEEDBACK_CSV_TEMPLATE,
  REQUIRED_CSV_COLUMNS,
} from "@/lib/csv";
import { SIMULATED_SOURCES } from "@/app/api/feedback/_simulate";
import type { SimulatedSourceSummary } from "@/app/api/feedback/_constants";
import { SingleEntryForm } from "@/components/inbox/single-entry-form";
import { CsvImport } from "@/components/inbox/csv-import";
import { SimulatePanel } from "@/components/inbox/simulate-panel";
import { PageHeader } from "../../_components/page-header";

/**
 * The three ways feedback gets into LOOP: one at a time, in bulk from a file, or
 * from a channel integration. All three go through the same API, which re-checks
 * the caller's role, so hiding this page from viewers is a courtesy rather than
 * the control.
 */
export default async function IngestPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (principal.role === Role.VIEWER) {
    return (
      <>
        <Header />
        <Card>
          <EmptyState
            title="Your role is read-only"
            description="Viewers can search and read the inbox but cannot add feedback. An admin can change your role in settings."
            action={
              <Link href="/inbox">
                <Button variant="secondary">Back to the inbox</Button>
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  // The channel list is whatever this workspace already uses, so hand-entered
  // feedback lands on the same channels the filters already know about.
  const channels = await prisma.feedback.groupBy({
    by: ["channel"],
    where: { workspaceId: principal.workspaceId },
    orderBy: { channel: "asc" },
  });

  const knownChannels = Array.from(
    new Set([...channels.map((row) => row.channel), ...SIMULATED_SOURCES.map((s) => s.channel)]),
  ).sort((a, b) => a.localeCompare(b));

  const sources: SimulatedSourceSummary[] = SIMULATED_SOURCES.map((source) => ({
    id: source.id,
    label: source.label,
    description: source.description,
    channel: source.channel,
  }));

  return (
    <>
      <Header />
      <div className="space-y-6">
        <SingleEntryForm channels={knownChannels} />
        <CsvImport
          limits={{
            columns: FEEDBACK_CSV_COLUMNS,
            requiredColumns: REQUIRED_CSV_COLUMNS,
            rowLimit: CSV_ROW_LIMIT,
            maxChars: CSV_MAX_CHARS,
            template: FEEDBACK_CSV_TEMPLATE,
          }}
        />
        <SimulatePanel sources={sources} />
      </div>
    </>
  );
}

function Header() {
  return (
    <PageHeader
      title="Add feedback"
      description="Everything added here is classified in the background, then appears in the inbox."
      action={
        <Link href="/inbox">
          <Button variant="secondary">Back to the inbox</Button>
        </Link>
      }
    />
  );
}
