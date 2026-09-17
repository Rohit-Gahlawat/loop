import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Shown while the server reads how much of the workspace is indexed. */
export default function AskLoading() {
  return (
    <>
      <PageHeader
        title="Ask LOOP"
        description="Ask a question and get an answer backed by real feedback."
      />
      <Card>
        <LoadingState label="Opening Ask LOOP" />
      </Card>
    </>
  );
}
