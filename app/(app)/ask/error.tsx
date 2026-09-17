"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Backstop for anything the Ask LOOP view does not handle itself. */
export default function AskError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Ask error boundary:", error);
  }, [error]);

  return (
    <>
      <PageHeader
        title="Ask LOOP"
        description="Ask a question and get an answer backed by real feedback."
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
