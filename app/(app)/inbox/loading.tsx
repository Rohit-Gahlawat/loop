import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Shown while the server fetches a page of feedback, including on every filter change. */
export default function InboxLoading() {
  return (
    <>
      <PageHeader title="Inbox" description="Search, filter and triage every piece of feedback." />
      <Card>
        <LoadingState label="Loading feedback" />
      </Card>
    </>
  );
}
