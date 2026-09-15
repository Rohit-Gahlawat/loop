"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Spinner } from "@/components/ui/states";
import { PAGE_SIZES } from "@/app/api/feedback/_constants";
import type { FeedbackPage } from "@/app/api/feedback/_query";

/** Page and page size are URL state, so a refresh lands on the same page. */
export function Pagination({ page, perPage, total, totalPages }: Omit<FeedbackPage, "items">) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function go(updates: Record<string, string>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === "" || value === "1") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 px-5 py-3">
      <p className="text-sm text-slate-500">
        {total === 0 ? "No results" : `Showing ${first} to ${last} of ${total}`}
        {pending ? <Spinner className="ml-2 align-middle" /> : null}
      </p>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-500">
          Per page
          <Select
            aria-label="Results per page"
            className="h-8 w-20"
            value={String(perPage)}
            onChange={(event) => go({ perPage: event.target.value, page: "1" })}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </Select>
        </label>

        <span className="text-sm text-slate-500">
          Page {page} of {totalPages}
        </span>

        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1 || pending}
          onClick={() => go({ page: String(page - 1) })}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages || pending}
          onClick={() => go({ page: String(page + 1) })}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
