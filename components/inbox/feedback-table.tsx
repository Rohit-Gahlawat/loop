"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FeedbackStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Table, Td, Th } from "@/components/ui/table";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/states";
import type { FeedbackListItem } from "@/app/api/feedback/_query";
import { STATUS_LABELS, SentimentBadge, StatusBadge, ThemeTags, formatDate } from "./tags";
import { sendJson } from "./client";

const STATUSES = [FeedbackStatus.NEW, FeedbackStatus.REVIEWED, FeedbackStatus.ACTIONED];

export function FeedbackTable({
  items,
  canWrite,
  filtered,
}: {
  items: FeedbackListItem[];
  canWrite: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Keeps the row showing the new status while the server re-renders behind it.
  const [optimistic, setOptimistic] = useState<Record<string, FeedbackStatus>>({});

  async function changeStatus(id: string, status: FeedbackStatus) {
    setError(null);
    setSavingId(id);
    setOptimistic((current) => ({ ...current, [id]: status }));

    const result = await sendJson<FeedbackListItem>(`/api/feedback/${id}`, "PATCH", { status });
    setSavingId(null);

    if (!result.ok) {
      setOptimistic((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      setError(result.message);
      return;
    }

    startTransition(() => router.refresh());
  }

  if (items.length === 0) {
    return filtered ? (
      <EmptyState
        title="Nothing matches these filters"
        description="Try a broader date range, a different channel, or clear the search."
      />
    ) : (
      <EmptyState
        title="No feedback yet"
        description="Add a single item, import a CSV, or simulate a channel to see how this looks with data in it."
        action={
          canWrite ? (
            <Link href="/inbox/ingest">
              <Button>Add feedback</Button>
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      {error ? (
        <div role="alert" className="border-b border-red-100 bg-red-50">
          <ErrorState
            title="That status change did not save"
            description={error}
            action={
              <Button size="sm" variant="secondary" onClick={() => setError(null)}>
                Dismiss
              </Button>
            }
          />
        </div>
      ) : null}

      <Table>
        <thead>
          <tr>
            <Th className="w-2/5">Feedback</Th>
            <Th>Channel</Th>
            <Th>Sentiment</Th>
            <Th>Themes</Th>
            <Th>Received</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const status = optimistic[item.id] ?? item.status;

            return (
              <tr key={item.id}>
                <Td>
                  <p className="text-slate-900">{item.content}</p>
                  {item.customerLabel ? (
                    <p className="mt-1 text-xs text-slate-500">{item.customerLabel}</p>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap">{item.channel}</Td>
                <Td>
                  <SentimentBadge sentiment={item.sentiment} />
                </Td>
                <Td>
                  <ThemeTags themes={item.themes} />
                </Td>
                <Td className="whitespace-nowrap text-slate-500">{formatDate(item.createdAt)}</Td>
                <Td>
                  {canWrite ? (
                    <span className="flex items-center gap-2">
                      <Select
                        aria-label={`Status for feedback received ${formatDate(item.createdAt)}`}
                        className="h-8 w-32"
                        value={status}
                        disabled={savingId === item.id}
                        onChange={(event) => changeStatus(item.id, event.target.value as FeedbackStatus)}
                      >
                        {STATUSES.map((option) => (
                          <option key={option} value={option}>
                            {STATUS_LABELS[option]}
                          </option>
                        ))}
                      </Select>
                      {savingId === item.id ? <Spinner /> : null}
                    </span>
                  ) : (
                    <StatusBadge status={status} />
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>

      <p className="sr-only" aria-live="polite">
        {savingId ? "Saving status change" : ""}
      </p>
    </>
  );
}
