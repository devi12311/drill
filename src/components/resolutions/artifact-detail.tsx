"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/chat/markdown";
import { ArtifactDag } from "./dag";
import { ArtifactForm } from "./artifact-form";
import type { ArtifactDraft, ArtifactGraph } from "@/lib/artifacts/types";

/** Shape of GET /api/artifacts/[id] (artifact row + usernames). */
export interface ArtifactDetailData {
  id: string;
  conversationId: string | null;
  title: string;
  summary: string;
  rootCause: string;
  symptoms: string[];
  affectedServices: string[];
  tags: string[];
  resolutionSteps: string[];
  verificationSteps: string[];
  graph: ArtifactGraph;
  createdAt: string;
  updatedAt: string;
  createdByUsername: string | null;
  lastEditedByUsername: string | null;
}

function toDraft(a: ArtifactDetailData): ArtifactDraft {
  return {
    title: a.title,
    summary: a.summary,
    symptoms: a.symptoms,
    affected_services: a.affectedServices,
    root_cause: a.rootCause,
    resolution_steps: a.resolutionSteps,
    verification_steps: a.verificationSteps,
    tags: a.tags,
    graph: a.graph,
  };
}

export function ArtifactDetail({
  artifact: initial,
  currentUsername,
}: {
  artifact: ArtifactDetailData;
  currentUsername: string | null;
}) {
  const router = useRouter();
  const [artifact, setArtifact] = useState(initial);
  const [editing, setEditing] = useState<ArtifactDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isResolver =
    currentUsername != null && currentUsername === artifact.createdByUsername;

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setArtifact({ ...artifact, ...body });
      setEditing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        method: "DELETE",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push("/resolutions");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="space-y-5">
        <div className="text-caption-tracked uppercase text-bone-gray">
          Editing artifact
        </div>
        <ArtifactForm draft={editing} onChange={setEditing} />
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="min-w-0 flex-1 truncate text-body-sm text-traffic-red">
            {error}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              disabled={busy || !editing.title.trim()}
            >
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-heading text-warm-off-white">{artifact.title}</h1>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditing(toDraft(artifact))}
            >
              Edit
            </Button>
            {isResolver && (
              <Button
                variant="secondary"
                size="sm"
                className="text-traffic-red hover:text-traffic-red"
                onClick={remove}
                disabled={busy}
              >
                Unresolve
              </Button>
            )}
          </div>
        </div>
        <div className="text-caption-tracked mt-2 uppercase text-bone-gray">
          resolved by {artifact.createdByUsername ?? "unknown"}
          {" · "}
          {new Date(artifact.createdAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          {artifact.lastEditedByUsername &&
            ` · last edited by ${artifact.lastEditedByUsername}`}
        </div>
        {error && <p className="mt-2 text-body-sm text-traffic-red">{error}</p>}
      </div>

      {(artifact.affectedServices.length > 0 || artifact.tags.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {artifact.affectedServices.map((svc) => (
            <span
              key={svc}
              className="rounded-sm bg-smoke-charcoal px-2 py-0.5 font-mono text-[12px] text-pale-stone"
            >
              {svc}
            </span>
          ))}
          {artifact.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-sm border border-border px-2 py-0.5 text-[12px] text-bone-gray"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <Markdown>{artifact.summary}</Markdown>

      {artifact.symptoms.length > 0 && (
        <section>
          <h2 className="text-caption-tracked uppercase text-bone-gray">
            Symptoms
          </h2>
          <ul className="mt-2 space-y-1.5">
            {artifact.symptoms.map((s) => (
              <li
                key={s}
                className="flex items-baseline gap-2.5 font-mono text-body-sm text-warm-off-white"
              >
                <span className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-traffic-yellow" />
                {s}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-caption-tracked uppercase text-bone-gray">
          Root cause
        </h2>
        <Markdown className="mt-2">{artifact.rootCause}</Markdown>
      </section>

      {artifact.graph.nodes.length > 0 && (
        <section>
          <h2 className="text-caption-tracked uppercase text-bone-gray">
            Failure propagation
          </h2>
          <div className="mt-2 rounded-lg bg-smoke-charcoal py-4">
            <ArtifactDag graph={artifact.graph} />
          </div>
        </section>
      )}

      {artifact.resolutionSteps.length > 0 && (
        <section>
          <h2 className="text-caption-tracked uppercase text-bone-gray">
            Resolution steps
          </h2>
          <ol className="mt-2 space-y-2">
            {artifact.resolutionSteps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 font-mono text-body-sm text-bone-gray">
                  {i + 1}.
                </span>
                <Markdown className="min-w-0 flex-1 text-body-sm">
                  {step}
                </Markdown>
              </li>
            ))}
          </ol>
        </section>
      )}

      {artifact.verificationSteps.length > 0 && (
        <section>
          <h2 className="text-caption-tracked uppercase text-bone-gray">
            Verify the fix
          </h2>
          <ol className="mt-2 space-y-2">
            {artifact.verificationSteps.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 shrink-0 font-mono text-body-sm text-bone-gray">
                  {i + 1}.
                </span>
                <Markdown className="min-w-0 flex-1 text-body-sm">
                  {step}
                </Markdown>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
