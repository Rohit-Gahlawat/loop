"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/states";
import type { SimulateResult, SimulatedSourceSummary } from "@/app/api/feedback/_constants";
import { sendJson } from "./client";

const BATCH_SIZES = [5, 10, 15, 25];

/**
 * Stands in for the channel integrations LOOP would really have. One press drops
 * a batch of believable feedback into the workspace, so the inbox, the filters
 * and the pipeline can all be shown working with data arriving live.
 */
export function SimulatePanel({ sources }: { sources: SimulatedSourceSummary[] }) {
  const router = useRouter();

  const [count, setCount] = useState(10);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<SimulateResult | null>(null);

  async function run(source: SimulatedSourceSummary) {
    setError(null);
    setDone(null);
    setBusySource(source.id);

    const result = await sendJson<SimulateResult>("/api/feedback/simulate", "POST", {
      source: source.id,
      count,
    });
    setBusySource(null);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setDone(result.data);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader
        title="Simulate a channel"
        description="Stands in for a live integration so you can watch feedback arrive."
      />
      <CardBody className="space-y-4">
        <Field label="Items per batch" htmlFor="simulate-count">
          <Select
            id="simulate-count"
            className="w-40"
            value={String(count)}
            onChange={(event) => setCount(Number(event.target.value))}
          >
            {BATCH_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} items
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex flex-col justify-between gap-3 rounded-md border border-slate-200 p-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{source.label}</p>
                <p className="mt-0.5 text-xs text-slate-500">{source.description}</p>
                <p className="mt-1 text-xs text-slate-400">Lands as &ldquo;{source.channel}&rdquo;</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busySource !== null}
                onClick={() => run(source)}
              >
                {busySource === source.id ? <Spinner /> : null}
                {busySource === source.id ? "Receiving" : "Receive batch"}
              </Button>
            </div>
          ))}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}

        {done ? (
          <p role="status" className="text-sm text-emerald-700">
            {done.created} items arrived on {done.channel}. They are in the inbox now and will be
            classified shortly.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
