"use client";

import Link from "next/link";

export interface ArtifactListItem {
  id: string;
  title: string;
  summary: string;
  symptoms: string[];
  affected_services: string[];
  tags: string[];
  resolved_by: string | null;
  updated_at: string;
}

export function ArtifactCard({ artifact }: { artifact: ArtifactListItem }) {
  return (
    <Link
      href={`/resolutions/${artifact.id}`}
      className="block rounded-lg border border-border bg-smoked-onyx p-4 transition-colors hover:border-slate-hearth hover:bg-smoke-charcoal"
    >
      <div className="text-body font-medium text-warm-off-white">
        {artifact.title}
      </div>
      <p className="mt-1.5 line-clamp-2 text-body-sm text-pale-stone">
        {artifact.summary}
      </p>
      {artifact.affected_services.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {artifact.affected_services.slice(0, 4).map((svc) => (
            <span
              key={svc}
              className="rounded-sm bg-smoke-charcoal px-1.5 py-0.5 font-mono text-[11px] text-pale-stone"
            >
              {svc}
            </span>
          ))}
          {artifact.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-bone-gray"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="text-caption-tracked mt-3 uppercase text-bone-gray">
        resolved{" "}
        {new Date(artifact.updated_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
        {artifact.resolved_by ? ` by ${artifact.resolved_by}` : ""}
      </div>
    </Link>
  );
}
