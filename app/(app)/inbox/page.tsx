import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

export default function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" description="Search, filter and triage every piece of feedback." />
      <Card>
        <EmptyState title="No feedback yet" description="This view is not built yet." />
      </Card>
    </>
  );
}
