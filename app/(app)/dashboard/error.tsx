"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Backstop for anything the dashboard does not handle itself, including a chart that throws. */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard error boundary:", error);
  }, [error]);

  return (
    <>
      <PageHeader title="Dashboard" description="The shape of your feedback at a glance." />
      <Card>
        <ErrorState
          title="Something went wrong drawing this view"
          description="Try again. If it keeps happening, the details are in the server log."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </Card>
    </>
  );
}
