"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/states";
import { PageHeader } from "../_components/page-header";

/** Backstop for anything the inbox pages do not handle themselves. */
export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Inbox error boundary:", error);
  }, [error]);

  return (
    <>
      <PageHeader title="Inbox" description="Search, filter and triage every piece of feedback." />
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
