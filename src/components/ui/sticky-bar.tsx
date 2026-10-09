import { cn } from "@/lib/utils";

/**
 * The bar that holds a long page's decision — Save, Import — pinned to the top
 * of the scrolling pane, so the button and the "2 problems" that block it are
 * never a screen away. It bleeds to the column edge (`-mx-6 px-6`, the page's
 * own gutter). Opaque on purpose: no backdrop-filter over a long page
 * (DESIGN.md, Don'ts).
 */
export function StickyBar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-background px-6 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
