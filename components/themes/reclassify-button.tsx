"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/states";
import { sendJson } from "@/components/inbox/client";

/**
 * Runs classification again over a bounded set of items.
 *
 * Only rendered for admins and analysts, but that is presentation, not access
 * control: `POST /api/themes/reclassify` checks the role itself and answers a
 * viewer with a 403 whether or not this button was ever on screen.
 *
 * A model request takes seconds, so the button says what it is doing while it
 * waits and reports what happened afterwards rather than silently refreshing.
 * The page behind it is a server component, so the refresh is what makes the
 * new counts appear.
 */

export type ReclassifyTarget =
  | { target: "unclassified"; limit?: number }
  | { target: "theme"; themeId: string; limit?: number }
  | { target: "items"; feedbackIds: string[] };

type ReclassifyResult = {
  requested: number;
  notFound: number;
  classified: number;
  skipped: number;
  needsReview: string[];
  newThemes: string[];
};

function summarise(result: ReclassifyResult): string {
  const parts: string[] = [];

  parts.push(
    result.classified === 0
      ? "Nothing was classified."
      : `Classified ${result.classified} ${result.classified === 1 ? "item" : "items"}.`,
  );

  if (result.needsReview.length > 0) {
    parts.push(
      `${result.needsReview.length} could not be read back and ${result.needsReview.length === 1 ? "was" : "were"} left for review.`,
    );
  }
  if (result.newThemes.length > 0) {
    parts.push(`New ${result.newThemes.length === 1 ? "theme" : "themes"}: ${result.newThemes.join(", ")}.`);
  }
  if (result.skipped > 0) {
    parts.push(`${result.skipped} already had a result.`);
  }

  return parts.join(" ");
}

export function ReclassifyButton({
  target,
  label,
  pendingLabel = "Classifying",
  variant = "secondary",
  size = "sm",
}: {
  target: ReclassifyTarget;
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const busy = sending || refreshing;

  async function run() {
    setSending(true);
    setMessage(null);

    const result = await sendJson<ReclassifyResult>("/api/themes/reclassify", "POST", target);

    setSending(false);

    if (!result.ok) {
      setMessage({ tone: "error", text: result.message });
      return;
    }

    setMessage({ tone: "ok", text: summarise(result.data) });
    // The counts, the chart and the spike flags are all server-rendered, so
    // they only change once the page is asked for again.
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant={variant} size={size} onClick={run} disabled={busy}>
        {busy ? <Spinner /> : null}
        {busy ? pendingLabel : label}
      </Button>

      <p
        aria-live="polite"
        className={message?.tone === "error" ? "text-xs text-red-600" : "text-xs text-slate-500"}
      >
        {message?.text ?? ""}
      </p>
    </div>
  );
}
