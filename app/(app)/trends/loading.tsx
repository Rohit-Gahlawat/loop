import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/**
 * Shown while the server groups the counts, including on every filter change
 * and every change of comparison window.
 *
 * The spike cards keep their shape while the numbers are fetched, so the page
 * does not jump from a short skeleton to a tall one and back.
 */
export default function TrendsLoading() {
  return (
    <>
      <PageHeader title="Trends" description="Which themes are growing, and which are spiking." />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {["first", "second", "third"].map((key) => (
            <Card key={key}>
              <CardBody>
                <div className="h-4 w-32 rounded bg-slate-100" />
                <div className="mt-3 h-8 w-12 rounded bg-slate-100" />
                <div className="mt-3 h-4 w-40 rounded bg-slate-100" />
              </CardBody>
            </Card>
          ))}
        </div>

        <Card>
          <LoadingState label="Counting the themes" />
        </Card>
      </div>
    </>
  );
}
