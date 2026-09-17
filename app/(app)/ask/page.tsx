import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { getPrincipal } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { embeddingCoverage } from "@/lib/search/embed";
import { PageHeader } from "../_components/page-header";
import { AskConsole } from "./_components/ask-console";

/**
 * Ask LOOP.
 *
 * The page itself only reports how much of the workspace is searchable. The
 * questions and answers are a conversation, so they live in a client component
 * that talks to `POST /api/ask`, which applies the same session and workspace
 * rules this page does.
 */

export const dynamic = "force-dynamic";

const DESCRIPTION = "Ask a question and get an answer backed by real feedback.";

export default async function AskPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  let coverage;
  try {
    coverage = await embeddingCoverage(principal.workspaceId);
  } catch (error) {
    console.error("Ask page failed to read the search index:", error);
    return (
      <>
        <PageHeader title="Ask LOOP" description={DESCRIPTION} />
        <Card>
          <ErrorState
            title="The search index could not be read"
            description="Reload the page. If it keeps happening, the details are in the server log."
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Ask LOOP" description={DESCRIPTION} />
      <AskConsole coverage={coverage} canBuildIndex={principal.role !== Role.VIEWER} />
    </>
  );
}
