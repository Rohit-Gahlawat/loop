"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/states";
import { sendJson } from "@/components/inbox/client";
import type { ReportDetail } from "@/app/api/reports/_content";

/**
 * One click generates a report.
 *
 * The period is the only real input. Presets cover what anyone actually asks
 * for, and the two date fields are there for the case a preset does not fit.
 * Everything is validated again by Zod on the server, which is the only thing
 * that decides what gets saved.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function lastDays(count: number): { from: string; to: string } {
  const to = new Date();
  return { from: day(new Date(to.getTime() - (count - 1) * DAY_MS)), to: day(to) };
}

function thisMonth(): { from: string; to: string } {
  const now = new Date();
  return {
    from: day(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))),
    to: day(now),
  };
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Last 7 days", range: () => lastDays(7) },
  { label: "Last 30 days", range: () => lastDays(30) },
  { label: "Last 90 days", range: () => lastDays(90) },
  { label: "This month", range: thisMonth },
];

export function GeneratePanel() {
  const router = useRouter();
  const initial = lastDays(30);

  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidRange = from !== "" && to !== "" && from > to;

  async function generate() {
    if (busy || invalidRange) return;

    setBusy(true);
    setError(null);

    const result = await sendJson<ReportDetail>("/api/reports", "POST", {
      from: from || undefined,
      to: to || undefined,
      title: title.trim() || undefined,
    });

    setBusy(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    router.refresh();
    router.push(`/reports/${result.data.id}`);
  }

  return (
    <Card>
      <CardHeader
        title="Generate a report"
        description="The figures are counted from your feedback. The written summary is added around them."
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              onClick={() => {
                const range = preset.range();
                setFrom(range.from);
                setTo(range.to);
              }}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="From" htmlFor="report-from">
            <Input
              id="report-from"
              type="date"
              value={from}
              disabled={busy}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field
            label="To"
            htmlFor="report-to"
            error={invalidRange ? "The end of the period is before the start." : undefined}
          >
            <Input
              id="report-to"
              type="date"
              value={to}
              disabled={busy}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
          <Field label="Title" htmlFor="report-title" hint="Optional.">
            <Input
              id="report-title"
              value={title}
              maxLength={120}
              disabled={busy}
              placeholder="Voice of Customer"
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={generate} disabled={busy || invalidRange}>
            {busy ? <Spinner /> : null}
            {busy ? "Generating" : "Generate report"}
          </Button>
          {busy ? (
            <p className="text-sm text-slate-500">
              Counting the period, then writing the summary. This usually takes under a
              minute.
            </p>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
