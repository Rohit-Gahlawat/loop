"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Backstop for anything the page does not handle itself, including a chart that throws. */
export default function TrendsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Trends error boundary:", error);
  }, [error]);

  return (
    <>
      <PageHeader title="Trends" description="Which themes are growing, and which are spiking." />
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
