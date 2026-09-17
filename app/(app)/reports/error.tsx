"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Backstop for anything the report views do not handle themselves. */
export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Reports error boundary:", error);
  }, [error]);

  return (
    <>
      <PageHeader
        title="Reports"
        description="Generate a Voice-of-Customer digest for any period."
      />
      <Card>
        <ErrorState
          title="Something went wrong loading this view"
          description="Try again. If it keeps happening, the details are in the server log."
          action={<Button onClick={reset}>Try again</Button>}
        />
      </Card>
    </>
  );
}
