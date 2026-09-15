import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Generate a Voice-of-Customer digest for any period." />
      <Card>
        <EmptyState title="No reports yet" description="This view is not built yet." />
      </Card>
    </>
  );
}
