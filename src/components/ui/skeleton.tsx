import { cn } from "@/lib/utils";

/**
 * A placeholder that occupies the space its content will.
 *
 * Every loading state in the app was a one-line `<p>Loading…</p>` standing in for
 * a table or a grid, so the document height collapsed and then jumped — and on a
 * refetch the browser clamped the scroll offset on the way down. A skeleton is
 * not decoration here: holding the layout still is the point.
 *
 * DESIGN.md forbids shadows and keeps radii at 4px/8px, so this is a flat block
 * that pulses on the surface colour rather than a shimmer gradient.
 */
export function Skeleton({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-smoke-charcoal", className)}
      {...props}
    />
  );
}

/** Stand-in for a `DataTable`, sized by its row count. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="border-b border-border px-4 py-2.5">
        <Skeleton className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="border-b border-border/60 px-4 py-3 last:border-0">
          <Skeleton className="h-3.5" style={{ width: `${88 - (i % 4) * 12}%` }} />
        </div>
      ))}
    </div>
  );
}
