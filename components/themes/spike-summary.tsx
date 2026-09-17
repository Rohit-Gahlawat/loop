import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { formatCount } from "@/components/charts/theme";
import type { ThemeTrend } from "@/app/api/themes/_trends";
import { describeChange } from "./theme-change";
import { inboxHref } from "./theme-links";

/**
 * The themes that have grown against the period before them.
 *
 * This is the one thing on the page that is worth interrupting somebody for, so
 * it sits above the chart and the table and says the number, what it was
 * before, and where to read the feedback behind it.
 *
 * Nothing spiking is a real answer, not an empty state, so the caller renders a
 * plain line of text instead of a card grid when the list is empty.
 */
export function SpikeSummary({
  themes,
  windowDays,
  filters,
}: {
  themes: ThemeTrend[];
  windowDays: number;
  filters: Record<string, string>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {themes.map((theme) => (
        <Card key={theme.id}>
          <CardBody>
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: theme.color }}
                />
                {theme.name}
              </p>
              <Badge tone={theme.emerging ? "info" : "warning"}>
                {theme.emerging ? "New" : "Spiking"}
              </Badge>
            </div>

            <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">
              {formatCount(theme.current)}
            </p>
            <p className="text-sm text-slate-500">{`in the last ${windowDays} days`}</p>

            <p className="mt-2 text-sm text-slate-600">
              <span aria-hidden className="mr-1">
                {theme.change > 0 ? "↑" : theme.change < 0 ? "↓" : "→"}
              </span>
              {describeChange(theme, windowDays)}
            </p>

            <Link
              href={inboxHref(theme.id, filters)}
              className="mt-3 inline-block text-sm font-medium text-indigo-700 hover:text-indigo-900"
            >
              {`Read the ${formatCount(theme.total)} ${theme.total === 1 ? "item" : "items"} in this theme`}
            </Link>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
