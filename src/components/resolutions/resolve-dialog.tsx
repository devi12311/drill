"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ArtifactForm } from "./artifact-form";
import type { ArtifactDraft } from "@/lib/artifacts/types";

type Phase =
  | { name: "compose" }
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
  const [phase, setPhase] = useState<Phase>({ name: "compose" });
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const generate = useCallback(
    async (resolverNote: string) => {
      setPhase({ name: "generating" });
      try {
        const res = await fetch(
          `/api/conversations/${conversationId}/resolve`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ note: resolverNote.trim() || undefined }),
          },
        );
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
    },
    [conversationId],
  );

  // Start each open on the compose step; the user chooses when to generate.
  useEffect(() => {
    if (open) {
      setSaveError(null);
      setNote("");
      setPhase({ name: "compose" });
    }
  }, [open]);

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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Resolve investigation</DialogTitle>
          <DialogDescription>
            Holmes distills this conversation into a resolution artifact for
            the team treasury. Review and correct it before saving — it
            becomes shared knowledge.
          </DialogDescription>
        </DialogHeader>

        {phase.name === "compose" && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label
                htmlFor="resolver-note"
                className="text-body-sm font-medium text-bone-white"
              >
                How was this actually resolved?{" "}
                <span className="font-normal text-bone-gray">(optional)</span>
              </label>
              <p className="text-body-sm text-bone-gray">
                Describe what you did to fix it — including anything done outside
                this chat. Holmes treats this as the authoritative account when
                writing the root cause, resolution, and verification steps.
              </p>
              <Textarea
                id="resolver-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                autoFocus
                placeholder="e.g. Scaled the statefulset to 0, deleted the corrupt PVC, scaled back up. Verified pods Ready and the alert cleared."
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <Button variant="secondary" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => generate(note)}>Generate draft</Button>
            </div>
          </div>
        )}

        {phase.name === "generating" && (
          <div className="flex items-center gap-3 py-10 text-body-sm text-bone-gray">
            <span className="size-2 animate-pulse rounded-full bg-gold-leaf" />
            Distilling investigation…
          </div>
        )}

        {phase.name === "error" && (
          <div className="space-y-4 py-4">
            <p className="text-body-sm text-traffic-red">{phase.message}</p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => setPhase({ name: "compose" })}
              >
                Back
              </Button>
              <Button onClick={() => generate(note)}>Retry</Button>
            </div>
          </div>
        )}

        {phase.name === "editing" && (
          <>
            <DialogBody>
              <ArtifactForm
                draft={phase.draft}
                onChange={(draft) => setPhase({ name: "editing", draft })}
              />
            </DialogBody>
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
