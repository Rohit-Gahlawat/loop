import { Card, CardBody } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/**
 * Shown while the server aggregates, including on every filter change.
 *
 * The tiles and cards keep their shape while the numbers are fetched, so the
 * page does not jump from a short skeleton to a tall dashboard and back.
 */
export default function DashboardLoading() {
  return (
    <>
      <PageHeader title="Dashboard" description="The shape of your feedback at a glance." />

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {["total", "negative", "new"].map((key) => (
            <Card key={key}>
              <CardBody>
                <div className="h-4 w-24 rounded bg-slate-100" />
                <div className="mt-3 h-8 w-16 rounded bg-slate-100" />
                <div className="mt-3 h-4 w-32 rounded bg-slate-100" />
              </CardBody>
            </Card>
          ))}
        </div>

        <Card>
          <LoadingState label="Working out the numbers" />
        </Card>
      </div>
    </>
  );
}
