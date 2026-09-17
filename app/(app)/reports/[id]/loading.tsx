import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";

/** Shown while the server reads one saved report. */
export default function ReportLoading() {
  return (
    <Card>
      <LoadingState label="Loading report" />
    </Card>
  );
}
