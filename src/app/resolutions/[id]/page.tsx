"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  ArtifactDetail,
  type ArtifactDetailData,
} from "@/components/resolutions/artifact-detail";

export default function ResolutionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [artifact, setArtifact] = useState<ArtifactDetailData | null>(null);
  const [username, setUsername] = useState<string | null>(null);
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
    fetch("/api/auth/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { username?: string } | null) =>
        setUsername(me?.username ?? null),
      )
      .catch(() => {});
  }, [id]);

  return (
    <main className="h-dvh overflow-y-auto">
      <div className="mx-auto w-full max-w-[820px] px-6 py-8">
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
            <ArtifactDetail artifact={artifact} currentUsername={username} />
          )}
        </div>
      </div>
    </main>
  );
}
