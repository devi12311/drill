import * as React from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  align?: "left" | "right";
  /** Renders the cell; defaults to String(row[key]). */
  render?: (row: T) => React.ReactNode;
  className?: string;
}

/**
 * Minimal, DESIGN-true table (no table primitive exists in the app). Rows are
 * optionally clickable; header is a tracked caption row.
 *
 * Deliberately NOT a client component. It uses no hooks, and dropping the
 * directive is what lets a server page pass `render` callbacks — the column
 * definitions execute wherever the table does. `onRowClick` is the one prop that
 * needs a client boundary, so only pass it from a client component.
 */
export function DataTable<T>({
  columns,
  rows,
  getKey,
  onRowClick,
  empty = "Nothing to show.",
}: {
  columns: Column<T>[];
  rows: T[];
  getKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-body-sm text-bone-gray">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-body-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-2.5 text-caption-tracked font-normal uppercase text-bone-gray",
                  col.align === "right" ? "text-right" : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getKey(row, i)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn(
                "border-b border-border/60 last:border-0",
                onRowClick && "cursor-pointer hover:bg-smoke-charcoal",
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-4 py-2.5 text-pale-stone",
                    col.align === "right" && "text-right",
                    col.className,
                  )}
                >
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
