import { cn } from "@/lib/utils";

/**
 * A selectable summary tile: a tracked label, a count, and an optional footer.
 *
 * The one tile behind every "pick a group, see its members" surface — the
 * severity groups on the job and run pages and the technology shelves in the
 * check catalogue — so the selected state reads the same everywhere.
 *
 * An empty group is disabled rather than hidden: a stable grid is what lets the
 * eye find "Critical" in the same place on every visit.
 */
export function GroupTile({
  label,
  count,
  active,
  railClass,
  onSelect,
  children,
}: {
  label: string;
  count: number;
  active: boolean;
  /** Text-colour class for the 2px rail and the label; omitted for no rail. */
  railClass?: string;
  onSelect: () => void;
  /** Footer under the count — a detail line or a distribution bar. */
  children?: React.ReactNode;
}) {
  const empty = count === 0;
  return (
    <button
      type="button"
      disabled={empty}
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "relative flex flex-col gap-1 overflow-hidden rounded-lg border p-3 pl-4 text-left transition-colors",
        "focus-visible:border-ring focus-visible:outline-none",
        active
          ? "border-warm-off-white/40 bg-smoke-charcoal"
          : "border-border bg-card hover:border-input hover:bg-accent",
        empty && "cursor-default opacity-40 hover:border-border hover:bg-card",
      )}
    >
      {railClass && (
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[2px] bg-current",
            empty ? "text-border" : railClass,
          )}
        />
      )}
      <span
        className={cn(
          "truncate text-caption-tracked uppercase",
          railClass && !empty ? railClass : "text-bone-gray",
        )}
      >
        {label}
      </span>
      <span className="text-heading-sm tabular-nums text-warm-off-white">
        {count}
      </span>
      {children}
    </button>
  );
}
