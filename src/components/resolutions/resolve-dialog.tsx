"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ArtifactForm } from "./artifact-form";
import type { ArtifactDraft } from "@/lib/artifacts/types";

type Phase =
  | { name: "generating" }
  | { name: "editing"; draft: ArtifactDraft }
  | { name: "error"; message: string };

/**
 * Mark-resolved flow: Holmes distills the conversation into a draft, the
 * user reviews/edits every field, then saving creates (or replaces) the
 * resolution artifact and flips the conversation to resolved.
 */
export function ResolveDialog({
  open,
  onOpenChange,
  conversationId,
  onResolved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onResolved: (artifactId: string) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "generating" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setPhase({ name: "generating" });
    try {
      const res = await fetch(`/api/conversations/${conversationId}/resolve`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setPhase({ name: "editing", draft: body.draft as ArtifactDraft });
    } catch (err) {
      setPhase({
        name: "error",
        message:
          err instanceof Error ? err.message : "Failed to generate artifact",
      });
    }
  }, [conversationId]);

  useEffect(() => {
    if (open) {
      setSaveError(null);
      generate();
    }
  }, [open, generate]);

  async function save() {
    if (phase.name !== "editing") return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          ...phase.draft,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onOpenChange(false);
      onResolved(body.id as string);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-[640px] flex-col">
        <DialogHeader>
          <DialogTitle>Resolve investigation</DialogTitle>
          <DialogDescription>
            Holmes distills this conversation into a resolution artifact for
            the team treasury. Review and correct it before saving — it
            becomes shared knowledge.
          </DialogDescription>
        </DialogHeader>

        {phase.name === "generating" && (
          <div className="flex items-center gap-3 py-10 text-body-sm text-bone-gray">
            <span className="size-2 animate-pulse rounded-full bg-gold-leaf" />
            Distilling investigation…
          </div>
        )}

        {phase.name === "error" && (
          <div className="space-y-4 py-4">
            <p className="text-body-sm text-traffic-red">{phase.message}</p>
            <Button variant="secondary" onClick={generate}>
              Retry
            </Button>
          </div>
        )}

        {phase.name === "editing" && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <ArtifactForm
                draft={phase.draft}
                onChange={(draft) => setPhase({ name: "editing", draft })}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <p className="min-w-0 flex-1 truncate text-body-sm text-traffic-red">
                {saveError}
              </p>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => onOpenChange(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  onClick={save}
                  disabled={saving || !phase.draft.title.trim()}
                >
                  {saving ? "Saving…" : "Save to treasury"}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
