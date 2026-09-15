"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/ui/states";

/**
 * Shortcuts for the range every reader reaches for first.
 *
 * These write the same `from` and `to` keys the inbox filter bar reads and
 * writes, so a dashboard URL filters the inbox identically and the date inputs
 * below update to show what was chosen. They add a shortcut, not a second
 * source of truth.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC, because that is how the server reads `from` and `to`. */
function isoDay(offsetDays: number): string {
  return new Date(Date.now() - offsetDays * DAY_MS).toISOString().slice(0, 10);
}

type Preset = { key: string; label: string; range: () => { from: string; to: string } };

const PRESETS: Preset[] = [
  { key: "7", label: "Last 7 days", range: () => ({ from: isoDay(6), to: isoDay(0) }) },
  { key: "30", label: "Last 30 days", range: () => ({ from: isoDay(29), to: isoDay(0) }) },
  { key: "90", label: "Last 90 days", range: () => ({ from: isoDay(89), to: isoDay(0) }) },
];

const ALL_TIME = "all";

export function DateRangePresets() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  // Resolved after mount rather than during render: the presets are relative to
  // "now", and the server and the browser can sit either side of midnight.
  const [active, setActive] = useState<string | null>(null);

  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";

  useEffect(() => {
    if (!from && !to) {
      setActive(ALL_TIME);
      return;
    }
    const match = PRESETS.find((preset) => {
      const range = preset.range();
      return range.from === from && range.to === to;
    });
    setActive(match?.key ?? null);
  }, [from, to]);

  function apply(range: { from: string; to: string } | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (range) {
      next.set("from", range.from);
      next.set("to", range.to);
    } else {
      next.delete("from");
      next.delete("to");
    }
    next.delete("page");

    const query = next.toString();
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname));
  }

  const buttonClass = (key: string) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
      active === key ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100",
    );

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="mr-1 text-sm font-medium text-slate-700">Quick ranges</span>

      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          aria-pressed={active === preset.key}
          className={buttonClass(preset.key)}
          onClick={() => apply(preset.range())}
        >
          {preset.label}
        </button>
      ))}

      <button
        type="button"
        aria-pressed={active === ALL_TIME}
        className={buttonClass(ALL_TIME)}
        onClick={() => apply(null)}
      >
        All time
      </button>

      {pending ? <Spinner /> : null}
    </div>
  );
}
