import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Shown while the server reads the saved reports for this workspace. */
export default function ReportsLoading() {
  return (
    <>
      <PageHeader
        title="Reports"
        description="Generate a Voice-of-Customer digest for any period."
      />
      <Card>
        <LoadingState label="Loading reports" />
      </Card>
    </>
  );
}
