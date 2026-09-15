import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/**
 * The frame around every chart: a heading that names what is plotted, the chart
 * itself, an optional note about anything the chart cannot say for itself, and a
 * table of the same numbers behind a disclosure.
 *
 * The table is not decoration. It is how a value stays reachable for anyone who
 * cannot hover, cannot separate two hues, or is reading a printout.
 */
export function ChartCard({
  title,
  description,
  note,
  table,
  children,
}: {
  title: string;
  description?: string;
  note?: ReactNode;
  table?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader title={title} description={description} />
      <CardBody className="flex-1">{children}</CardBody>

      {note ? <p className="px-5 pb-4 text-sm text-slate-500">{note}</p> : null}

      {table ? (
        <details className="border-t border-slate-200">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-600 hover:text-slate-900">
            Show the numbers
          </summary>
          <div className="border-t border-slate-200">{table}</div>
        </details>
      ) : null}
    </Card>
  );
}
