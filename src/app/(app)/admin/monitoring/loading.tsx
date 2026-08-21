import { Skeleton, TableSkeleton } from "@/components/ui/skeleton";

/**
 * Shown the moment a monitoring link is clicked, for as long as the server takes.
 *
 * The module had no `loading.tsx` at all, so a click produced nothing until the
 * whole page was ready — which is most of what "the buttons feel slow" was. It
 * holds the page's shape (a title, a description, a table) rather than collapsing
 * it to a line of text, so arriving content does not shove the layout around.
 */
export default function MonitoringLoading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-3.5 w-full max-w-[60ch]" />
      </div>
      <TableSkeleton rows={5} />
    </div>
  );
}
