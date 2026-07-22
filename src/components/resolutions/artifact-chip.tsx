"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookMarked } from "lucide-react";

/** Module-level cache: each cited artifact title is fetched once per page. */
const titleCache = new Map<string, Promise<string | null>>();

function fetchTitle(id: string): Promise<string | null> {
  let cached = titleCache.get(id);
  if (!cached) {
    cached = fetch(`/api/artifacts/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { title?: string } | null) => body?.title ?? null)
      .catch(() => null);
    titleCache.set(id, cached);
  }
  return cached;
}

/**
 * Inline rendering of a `[[artifact:<uuid>]]` citation emitted by Holmes.
 * Opens the resolution in the treasury.
 */
export function ArtifactChip({ id }: { id: string }) {
  const [title, setTitle] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchTitle(id).then((t) => {
      if (!alive) return;
      if (t) setTitle(t);
      else setMissing(true);
    });
    return () => {
      void (alive = false);
    };
  }, [id]);

  if (missing) {
    return (
      <span className="text-body-sm text-bone-gray">[removed resolution]</span>
    );
  }
  return (
    <Link
      href={`/resolutions/${id}`}
      className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-input px-2 py-0.5 align-baseline text-body-sm text-pale-stone no-underline transition-colors hover:bg-iron-veil hover:text-warm-off-white"
    >
      <BookMarked className="size-3 shrink-0" />
      <span className="truncate">{title ?? "resolution"}</span>
    </Link>
  );
}
