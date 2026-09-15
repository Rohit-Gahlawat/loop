import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

export default function AskPage() {
  return (
    <>
      <PageHeader title="Ask LOOP" description="Ask a question and get an answer backed by real feedback." />
      <Card>
        <EmptyState title="Nothing to ask yet" description="This view is not built yet." />
      </Card>
    </>
  );
}
