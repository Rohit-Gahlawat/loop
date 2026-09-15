"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FeedbackStatus, Sentiment } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/states";
import { UNCLASSIFIED } from "@/app/api/feedback/_constants";
import type { FilterOptions } from "@/app/api/feedback/_query";
import { SENTIMENT_LABELS, STATUS_LABELS } from "./tags";

/**
 * Every filter lives in the URL, so the inbox survives a refresh, a back button
 * and a shared link. Nothing is held in component state except the search box,
 * which is debounced before it becomes a URL change.
 */

const SEARCH_DEBOUNCE_MS = 350;

export function FilterBar({
  options,
  activeFilterCount,
}: {
  options: FilterOptions;
  activeFilterCount: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const urlQuery = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(urlQuery);

  // Keeps the box in step when the URL changes from elsewhere, such as Clear all
  // or the browser's back button.
  const lastPushed = useRef(urlQuery);
  useEffect(() => {
    if (urlQuery !== lastPushed.current) {
      lastPushed.current = urlQuery;
      setSearch(urlQuery);
    }
  }, [urlQuery]);

  const apply = useCallback(
    (updates: Record<string, string>) => {
      const next = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        if (value === "") next.delete(key);
        else next.set(key, value);
      }

      // Any change to a filter puts you back on the first page. Page 3 of the old
      // result set is meaningless against the new one.
      if (!("page" in updates)) next.delete("page");

      const query = next.toString();
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (search === lastPushed.current) return;

    const timer = setTimeout(() => {
      lastPushed.current = search;
      apply({ q: search.trim() });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [search, apply]);

  const value = (key: string) => searchParams.get(key) ?? "";

  return (
    <Card className="mb-4">
      <CardBody className="space-y-4">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            lastPushed.current = search;
            apply({ q: search.trim() });
          }}
        >
          <Field label="Search" htmlFor="inbox-search" hint="Every word you type must appear in the feedback.">
            <Input
              id="inbox-search"
              type="search"
              placeholder="timeout, billing, mobile login…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </form>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Channel" htmlFor="filter-channel">
            <Select
              id="filter-channel"
              value={value("channel")}
              onChange={(event) => apply({ channel: event.target.value })}
            >
              <option value="">All channels</option>
              {options.channels.map((channel) => (
                <option key={channel.value} value={channel.value}>
                  {channel.value} ({channel.count})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sentiment" htmlFor="filter-sentiment">
            <Select
              id="filter-sentiment"
              value={value("sentiment")}
              onChange={(event) => apply({ sentiment: event.target.value })}
            >
              <option value="">Any sentiment</option>
              {Object.values(Sentiment).map((sentiment) => (
                <option key={sentiment} value={sentiment}>
                  {SENTIMENT_LABELS[sentiment]}
                </option>
              ))}
              <option value={UNCLASSIFIED}>Not classified yet</option>
            </Select>
          </Field>

          <Field label="Theme" htmlFor="filter-theme">
            <Select
              id="filter-theme"
              value={value("themeId")}
              onChange={(event) => apply({ themeId: event.target.value })}
            >
              <option value="">All themes</option>
              {options.themes.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Status" htmlFor="filter-status">
            <Select
              id="filter-status"
              value={value("status")}
              onChange={(event) => apply({ status: event.target.value })}
            >
              <option value="">Any status</option>
              {Object.values(FeedbackStatus).map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="From" htmlFor="filter-from">
              <Input
                id="filter-from"
                type="date"
                value={value("from")}
                max={value("to") || undefined}
                onChange={(event) => apply({ from: event.target.value })}
              />
            </Field>
            <Field label="To" htmlFor="filter-to">
              <Input
                id="filter-to"
                type="date"
                value={value("to")}
                min={value("from") || undefined}
                onChange={(event) => apply({ to: event.target.value })}
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={activeFilterCount === 0}
            onClick={() => startTransition(() => router.push(pathname))}
          >
            Clear all
          </Button>
          <span className="text-sm text-slate-500">
            {activeFilterCount === 0
              ? "No filters applied."
              : `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied.`}
          </span>
          {pending ? <Spinner /> : null}
        </div>
      </CardBody>
    </Card>
  );
}
