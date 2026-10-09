import type { ImportedFrom } from "@/lib/share/types";

/** Provenance of a row that arrived through a share link — text copied at import. */
export function ImportedBadge({ from }: { from: ImportedFrom }) {
  return (
    <span className="rounded-sm border border-border px-1.5 py-0.5 text-caption-tracked uppercase text-bone-gray">
      imported from {from.orgName}
      {from.author && <span className="normal-case tracking-normal"> · @{from.author}</span>}
    </span>
  );
}
