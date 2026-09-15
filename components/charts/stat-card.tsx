import type { ReactNode } from "react";
import { Card, CardBody } from "@/components/ui/card";

/**
 * A stat tile: a label, a value, and enough context underneath to stop the value
 * being read as something it is not.
 *
 * The value is set in proportional figures rather than tabular ones. Tabular
 * figures give every digit the width of a zero, which makes a number like 127
 * look loose at this size; they belong in columns that have to line up.
 *
 * `unavailable` is the important case. A percentage with an empty denominator is
 * not zero, it is unknown, and printing "0%" would read as good news. The tile
 * says so in words instead, in muted type so it never passes for a figure.
 */
export function StatCard({
  label,
  value,
  unavailable = false,
  delta,
  note,
}: {
  label: string;
  value: string;
  unavailable?: boolean;
  delta?: { direction: "up" | "down" | "level"; text: string };
  note?: ReactNode;
}) {
  const glyph = delta ? { up: "↑", down: "↓", level: "→" }[delta.direction] : null;

  return (
    <Card>
      <CardBody>
        <p className="text-sm font-medium text-slate-500">{label}</p>

        {unavailable ? (
          <p className="mt-1.5 text-lg font-medium text-slate-400">{value}</p>
        ) : (
          <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
        )}

        {delta ? (
          <p className="mt-1 text-sm text-slate-600">
            <span aria-hidden className="mr-1">
              {glyph}
            </span>
            {delta.text}
          </p>
        ) : null}

        {note ? <p className="mt-2 text-sm text-slate-500">{note}</p> : null}
      </CardBody>
    </Card>
  );
}
