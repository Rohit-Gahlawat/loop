import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

export default function TrendsPage() {
  return (
    <>
      <PageHeader title="Trends" description="Which themes are growing, and which are spiking." />
      <Card>
        <EmptyState title="No trends yet" description="This view is not built yet." />
      </Card>
    </>
  );
}
