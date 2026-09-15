import type { FeedbackStatus, Sentiment } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import type { FeedbackThemeTag } from "@/app/api/feedback/_query";

export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  NEW: "New",
  REVIEWED: "Reviewed",
  ACTIONED: "Actioned",
};

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  POS: "Positive",
  NEU: "Neutral",
  NEG: "Negative",
};

const sentimentTones = {
  POS: "positive",
  NEU: "neutral",
  NEG: "negative",
} as const;

const statusTones = {
  NEW: "info",
  REVIEWED: "warning",
  ACTIONED: "positive",
} as const;

export function StatusBadge({ status }: { status: FeedbackStatus }) {
  return <Badge tone={statusTones[status]}>{STATUS_LABELS[status]}</Badge>;
}

export function SentimentBadge({ sentiment }: { sentiment: Sentiment | null }) {
  if (!sentiment) {
    return <span className="text-xs text-slate-400">Unclassified</span>;
  }
  return <Badge tone={sentimentTones[sentiment]}>{SENTIMENT_LABELS[sentiment]}</Badge>;
}

export function ThemeTags({ themes }: { themes: FeedbackThemeTag[] }) {
  if (themes.length === 0) {
    return <span className="text-xs text-slate-400">None yet</span>;
  }

  return (
    <span className="flex flex-wrap gap-1">
      {themes.map((theme) => (
        <Badge key={theme.id} className="gap-1.5">
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: theme.color }}
          />
          {theme.name}
        </Badge>
      ))}
    </span>
  );
}

/** Stable across server and client so a date never renders differently after hydration. */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
