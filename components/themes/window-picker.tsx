"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/states";
import { DEFAULT_WINDOW_DAYS, WINDOWS } from "@/app/api/themes/_constants";

/**
 * How long a period a theme is compared against itself over.
 *
 * This is not a date filter. The date filter chooses which feedback counts at
 * all; this chooses how far back "before" reaches when deciding whether a theme
 * is spiking. Both live in the URL, so a link to a spike shows the reader the
 * same comparison the sender was looking at.
 */
export function WindowPicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const raw = Number(searchParams.get("window"));
  const active = (WINDOWS as readonly number[]).includes(raw) ? raw : DEFAULT_WINDOW_DAYS;

  function apply(days: number) {
    const next = new URLSearchParams(searchParams.toString());
    if (days === DEFAULT_WINDOW_DAYS) next.delete("window");
    else next.set("window", String(days));

    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium text-slate-700">Compare against</span>

      {WINDOWS.map((days) => (
        <button
          key={days}
          type="button"
          aria-pressed={active === days}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
            active === days ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100",
          )}
          onClick={() => apply(days)}
        >
          {`${days} days`}
        </button>
      ))}

      {pending ? <Spinner /> : null}
    </div>
  );
}
