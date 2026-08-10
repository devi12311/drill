"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  ArtifactDetail,
  type ArtifactDetailData,
} from "@/components/resolutions/artifact-detail";
import { useSession } from "@/components/session/session-provider";

export default function ResolutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useSession();
  const [artifact, setArtifact] = useState<ArtifactDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/artifacts/${id}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setArtifact(body);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load"),
      );
  }, [id]);

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 pb-20 pt-8">
        <Link
          href="/resolutions"
          className="inline-flex items-center gap-2 text-body-sm text-bone-gray hover:text-warm-off-white"
        >
          <ArrowLeft className="size-3.5" />
          Resolutions
        </Link>
        <div className="mt-6">
          {error ? (
            <p className="py-8 text-body-sm text-traffic-red">{error}</p>
          ) : !artifact ? (
            <p className="py-8 text-body-sm text-bone-gray">Loading…</p>
          ) : (
            <ArtifactDetail
              artifact={artifact}
              currentUsername={user.username}
            />
          )}
        </div>
      </div>
    </main>
  );
}
