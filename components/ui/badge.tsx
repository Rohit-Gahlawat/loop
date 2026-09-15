import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone = "neutral" | "positive" | "negative" | "info" | "warning";

const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  positive: "bg-emerald-100 text-emerald-800",
  negative: "bg-red-100 text-red-800",
  info: "bg-indigo-100 text-indigo-800",
  warning: "bg-amber-100 text-amber-800",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
