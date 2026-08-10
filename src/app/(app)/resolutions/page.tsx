"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  ArtifactCard,
  type ArtifactListItem,
} from "@/components/resolutions/artifact-card";
import { CHAT_HOME } from "@/lib/routes";

/**
 * The treasury: every resolved investigation across the team, searchable
 * by symptom text, service or tag.
 */
export default function ResolutionsPage() {
  const [query, setQuery] = useState("");
  const [service, setService] = useState("");
  const [tag, setTag] = useState("");
  const [items, setItems] = useState<ArtifactListItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (service) params.set("service", service);
        if (tag) params.set("tag", tag);
        const res = await fetch(`/api/artifacts?${params}`, {
          signal: controller.signal,
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setItems(body);
        setError(null);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Search failed");
        }
      } finally {
        if (!controller.signal.aborted) setLoaded(true);
      }
    }, 300);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, service, tag]);

  // Filter options come from the currently loaded results.
  const services = useMemo(
    () => [...new Set(items.flatMap((a) => a.affected_services))].sort(),
    [items],
  );
  const tags = useMemo(
    () => [...new Set(items.flatMap((a) => a.tags))].sort(),
    [items],
  );

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[920px] px-6 pb-20 pt-8">
      <Link
        href={CHAT_HOME}
        className="inline-flex items-center gap-2 text-body-sm text-bone-gray hover:text-warm-off-white"
      >
        <ArrowLeft className="size-3.5" />
        Investigations
      </Link>

      <div className="mt-6">
        <div className="text-caption-tracked uppercase text-bone-gray">
          Team treasury
        </div>
        <h1 className="mt-2 text-heading text-warm-off-white">Resolutions</h1>
        <p className="mt-1 max-w-[60ch] text-body text-pale-stone">
          Every resolved investigation, distilled. Search by symptom, error
          message or service — Holmes consults these too.
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-bone-gray" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="symptom, error message, service…"
            className="pl-9"
          />
        </div>
        <select
          value={service}
          onChange={(e) => setService(e.target.value)}
          aria-label="Filter by service"
          className="h-9 rounded-sm border border-input bg-transparent px-2 font-mono text-[12px] text-pale-stone focus:outline-none"
        >
          <option value="">all services</option>
          {services.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          aria-label="Filter by tag"
          className="h-9 rounded-sm border border-input bg-transparent px-2 font-mono text-[12px] text-pale-stone focus:outline-none"
        >
          <option value="">all tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6">
        {error ? (
          <p className="py-8 text-body-sm text-traffic-red">{error}</p>
        ) : !loaded ? (
          <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
        ) : items.length === 0 ? (
          <p className="py-8 text-body-sm text-bone-gray">
            {query || service || tag
              ? "No resolutions match."
              : "Nothing resolved yet — mark an investigation as resolved to start the treasury."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {items.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
