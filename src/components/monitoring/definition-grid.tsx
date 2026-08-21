"use client";

import { memo } from "react";

import { cn } from "@/lib/utils";

/**
 * The two library pages — the check catalogue and the investigation playbooks —
 * are the same surface: a shelf of authored definitions, read occasionally and
 * written rarely. This is that shelf.
 *
 * A tile carries identity and status, and nothing else. Everything a definition
 * SAYS lives one layer down, in the modal, because thirty checks each printing
 * their question is four screens of prose nobody reads — and thirty rows each
 * carrying Edit/Disable/Delete is ninety buttons competing with the one thing
 * the page is for, which is finding the definition you came for.
 *
 * The rail is the exception that proves it: colour is the only signal that
 * survives being scanned at grid speed, so severity gets the left edge and
 * everything else waits for a click. It is never the ONLY carrier — the modal
 * spells the severity out in words.
 */

export interface DefinitionTileProps {
  /**
   * Handed back to `onOpen` so the handler can be shared by every tile in the
   * grid. A per-tile `() => open(thisId)` arrow would be a new function on every
   * render of the page, which defeats the memo below entirely.
   */
  id: string;
  /** The line you scan for — the human name, not the identifier. */
  title: string;
  /** Mono second line: the stable ID. Omitted when the title already is one. */
  caption?: string;
  /**
   * Tailwind text-colour class for the 2px left rail (severity, status).
   * Pass one of the shared maps in `lib/monitoring/ui.ts` — never a raw colour,
   * or the same severity ends up two different hues in two views.
   */
  railClass?: string;
  /** One line of counts or dates, under the caption. */
  meta?: React.ReactNode;
  /** An uppercase state word — "disabled", "edited" — shown beside the caption. */
  marker?: string;
  /** Retired/inactive: the whole tile recedes rather than being annotated. */
  dimmed?: boolean;
  onOpen: (id: string) => void;
}

/**
 * Memoised, and every prop it takes is a primitive or a stable callback so the
 * comparison can actually succeed.
 *
 * The catalogue renders ~180 of these under a filter box, and opening a panel
 * re-renders the page (the open definition lives in the URL). Without a memo
 * that holds, both cost a re-render of all 180 tiles — including the ones
 * nothing about them changed.
 */
export const DefinitionTile = memo(function DefinitionTile({
  id,
  title,
  caption,
  railClass,
  meta,
  marker,
  dimmed,
  onOpen,
}: DefinitionTileProps) {
  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className={cn(
        "relative flex min-h-[74px] w-full flex-col gap-1 overflow-hidden rounded-lg border border-border bg-card p-3 pl-4 text-left transition-colors",
        "hover:border-input hover:bg-accent focus-visible:border-ring focus-visible:outline-none",
        dimmed && "opacity-50 hover:opacity-100",
      )}
    >
      {railClass && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-[2px] bg-current", railClass)}
        />
      )}
      <span className="text-body-sm text-warm-off-white">{title}</span>
      {(caption || marker) && (
        <span className="flex items-baseline gap-2">
          {caption && (
            <span className="truncate font-mono text-[12px] text-muted-cobalt">
              {caption}
            </span>
          )}
          {marker && (
            <span className="shrink-0 text-caption-tracked uppercase text-bone-gray">
              {marker}
            </span>
          )}
        </span>
      )}
      {meta && (
        <span className="mt-auto text-caption-tracked text-bone-gray">{meta}</span>
      )}
    </button>
  );
});

/** Three across in the 900px admin column; two, then one, as it narrows. */
export function DefinitionGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

/**
 * A named shelf. `note` is the count line the catalogue already carried — "13 of
 * 14 active" is the one number worth reading before opening anything.
 */
export function DefinitionSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-body font-medium text-warm-off-white">
        {title}
        {note && <span className="ml-2 text-body-sm text-bone-gray">{note}</span>}
      </h2>
      {children}
    </section>
  );
}
