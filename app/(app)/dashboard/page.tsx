import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" description="The shape of your feedback at a glance." />
      <Card>
        <EmptyState title="No charts yet" description="This view is not built yet." />
      </Card>
    </>
  );
}
