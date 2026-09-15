import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Table, Td, Th } from "@/components/ui/table";

/**
 * The pieces every chart is made of: a legend, a tooltip, and a table view.
 *
 * Text here always wears a text colour, never the series colour. A light hue is
 * illegible as small text on white, so identity comes from the coloured mark
 * beside the label rather than from tinting the label itself.
 */

export type LegendItem = {
  key: string;
  label: string;
  color: string;
  /** Shown beside the label, so the legend carries the numbers as well as the identity. */
  value?: string;
};

/**
 * Always present once a chart draws two or more series. A single-series chart
 * gets none: there is only one colour, and the card title already names it.
 */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-2 text-sm">
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-slate-600">{item.label}</span>
          {item.value ? (
            <span className="font-medium tabular-nums text-slate-900">{item.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export type TooltipRow = { key: string; label: string; value: string; color: string };

/**
 * The value leads and the series name follows, which is the legend's hierarchy
 * inverted: here the reader already knows the series and wants the number. The
 * key is a short stroke rather than a filled box, which at this size would be
 * data-weight ink doing a label's job.
 */
export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="pointer-events-none rounded-md border border-slate-200 bg-white px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-slate-500">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex items-center gap-2 text-sm whitespace-nowrap">
            <span
              aria-hidden
              className="h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="font-semibold tabular-nums text-slate-900">{row.value}</span>
            <span className="text-slate-500">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type TableColumn = { key: string; label: string; numeric?: boolean };
export type TableRow = { key: string; cells: ReactNode[] };

/**
 * The table twin every chart carries. A tooltip is an enhancement, never the
 * only way to read a value, and colour is never the only way to tell marks
 * apart, so each chart's numbers are also reachable as plain text.
 */
export function ChartTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: TableColumn[];
  rows: TableRow[];
}) {
  return (
    <Table>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <Th key={column.key} className={cn(column.numeric && "text-right")}>
              {column.label}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {row.cells.map((cell, index) => (
              <Td
                key={columns[index]?.key ?? index}
                className={cn(columns[index]?.numeric && "text-right tabular-nums")}
              >
                {cell}
              </Td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
