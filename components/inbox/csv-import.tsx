"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/states";
import { Table, Td, Th } from "@/components/ui/table";
import type { ImportResult } from "@/app/api/feedback/_constants";
import { sendJson } from "./client";

/**
 * Bulk import. The file is read in the browser and sent as text; parsing and
 * validation happen on the server so the same rules apply however the endpoint
 * is called. The limits are passed in from the server rather than imported, to
 * keep papaparse out of the browser bundle.
 */
export type CsvImportLimits = {
  columns: readonly string[];
  requiredColumns: readonly string[];
  rowLimit: number;
  maxChars: number;
  template: string;
};

export function CsvImport({ limits }: { limits: CsvImportLimits }) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  // Bumping the key gives the file input a fresh DOM node, which is how it gets cleared.
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }

    const text = await file.text();
    if (text.trim().length === 0) {
      setError("That file is empty.");
      return;
    }
    if (text.length > limits.maxChars) {
      setError("That file is too large. Split it and import again.");
      return;
    }

    setBusy(true);
    const response = await sendJson<ImportResult>("/api/feedback/import", "POST", { csv: text });
    setBusy(false);

    if (!response.ok) {
      setError(response.message);
      return;
    }

    setResult(response.data);
    setFile(null);
    setInputKey((key) => key + 1);
    if (response.data.imported > 0) router.refresh();
  }

  const templateHref = `data:text/csv;charset=utf-8,${encodeURIComponent(limits.template)}`;

  return (
    <Card>
      <CardHeader
        title="Import a CSV"
        description={`Columns: ${limits.columns.join(", ")}. Only ${limits.requiredColumns.join(" and ")} are required.`}
        action={
          <a
            href={templateHref}
            download="loop-feedback-template.csv"
            className="whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            Download template
          </a>
        }
      />
      <CardBody className="space-y-4">
        <form onSubmit={submit} className="space-y-4">
          <Field
            label="CSV file"
            htmlFor="csv-file"
            hint={`Up to ${limits.rowLimit.toLocaleString("en-GB")} rows. Sentiment and themes are worked out after import, so leave them out.`}
          >
            <Input
              key={inputKey}
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="h-auto py-2 file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm file:text-slate-700"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
                setResult(null);
              }}
            />
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          ) : null}

          <Button type="submit" disabled={busy || !file}>
            {busy ? <Spinner /> : null}
            {busy ? "Importing" : "Import"}
          </Button>
        </form>

        {result ? <ImportReport result={result} /> : null}
      </CardBody>
    </Card>
  );
}

function ImportReport({ result }: { result: ImportResult }) {
  return (
    <div role="status" className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-700">
        <span className="font-medium text-slate-900">{result.imported}</span> of {result.totalRows} rows
        imported.{" "}
        {result.failed > 0 ? (
          <span className="font-medium text-red-700">{result.failed} rejected.</span>
        ) : (
          <span className="text-emerald-700">Nothing was rejected.</span>
        )}
      </p>

      {result.errors.length > 0 ? (
        <div className="max-h-64 overflow-y-auto rounded border border-slate-200 bg-white">
          <Table>
            <thead>
              <tr>
                <Th className="w-20">Row</Th>
                <Th>Why it was rejected</Th>
              </tr>
            </thead>
            <tbody>
              {result.errors.map((rowError) => (
                <tr key={`${rowError.row}-${rowError.message}`}>
                  <Td className="font-mono text-xs">{rowError.row}</Td>
                  <Td>{rowError.message}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : null}

      {result.errorsTruncated ? (
        <p className="text-xs text-slate-500">
          Only the first {result.errors.length} problems are listed. Fix these and import the rest again.
        </p>
      ) : null}
    </div>
  );
}
