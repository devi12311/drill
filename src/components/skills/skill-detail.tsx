"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, MoreHorizontal, Pencil, Play, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ImportedBadge } from "@/components/share/imported-badge";
import { useSession } from "@/components/session/session-provider";
import { SkillScope } from "./skill-badges";
import { SkillEditor } from "./skill-editor";
import { SkillPageFrame, SkillReader } from "./skill-reader";
import { SkillShareMenu } from "./skill-share-menu";
import { sendJson } from "@/lib/http";
import { SKILL_SEED_KEY } from "@/lib/skills/conversation-steps";
import { canRunSkill, toSkillDraft, type SkillView } from "@/lib/skills/types";
import { skillRunUrl } from "@/lib/workspace/nav";

/** `<name>-copy`, kept inside the 64-character name rule. */
function copyName(name: string): string {
  return `${name.slice(0, 59).replace(/-+$/, "")}-copy`;
}

/**
 * One skill's page: read it first — that is what most visits are for (what will
 * Holmes follow? what does this shared one do?) — and edit it as a separate
 * mode, so the page never mixes a half-edited form with sharing or running it.
 * Mirrors `ArtifactDetail` for resolutions.
 */
export function SkillDetail({ skill: initial }: { skill: SkillView }) {
  const router = useRouter();
  const { user } = useSession();
  const [skill, setSkill] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isAuthor = skill.createdBy === user.id;
  const canRun = canRunSkill(skill, user.id);

  function duplicate() {
    // Handed over like the chat builder's draft: the new-skill form reads it once.
    sessionStorage.setItem(
      SKILL_SEED_KEY,
      JSON.stringify({ ...toSkillDraft(skill), name: copyName(skill.name) }),
    );
    router.push("/skills/new?from=duplicate");
  }

  async function remove() {
    setError(null);
    try {
      await sendJson(`/api/skills/${skill.id}`, undefined, "DELETE");
      router.push("/skills");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete it");
    }
  }

  if (editing) {
    return (
      <SkillPageFrame wide>
        <div className="mt-2">
          <SkillEditor
            skill={skill}
            onSaved={(next) => {
              setSkill(next);
              setEditing(false);
              setJustSaved(true);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </SkillPageFrame>
    );
  }

  const meta = [
    skill.createdByName ? `by @${skill.createdByName}` : "by a former member",
    `edited ${new Date(skill.updatedAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`,
    skill.alwaysOn ? "in every chat turn" : null,
  ].filter(Boolean);

  return (
    <SkillPageFrame>
      <header className="mt-6 mb-8 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <h1 className="min-w-0 font-mono text-heading break-all text-warm-off-white">
            {skill.name}
          </h1>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {canRun && (
              <Button asChild size="sm" className="gap-1.5">
                <Link href={skillRunUrl(skill.name)}>
                  <Play className="size-3.5" />
                  Run
                </Link>
              </Button>
            )}
            {skill.editable && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setJustSaved(false);
                  setEditing(true);
                }}
              >
                <Pencil className="size-3.5" />
                Edit
              </Button>
            )}
            <SkillShareMenu
              skill={skill}
              isAuthor={isAuthor}
              onChanged={setSkill}
              onError={setError}
              onEditSkill={skill.editable ? () => setEditing(true) : undefined}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More actions">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={duplicate}>
                  <Copy className="size-4" />
                  Duplicate as private
                </DropdownMenuItem>
                {skill.editable && (
                  <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                    <Trash2 className="size-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SkillScope skill={skill} />
          {skill.importedFrom && <ImportedBadge from={skill.importedFrom} />}
          <span className="text-caption-tracked uppercase text-bone-gray">{meta.join(" · ")}</span>
          {justSaved && (
            <span aria-live="polite" className="inline-flex items-center gap-1 text-body-sm text-bone-gray">
              <Check className="size-3.5 text-prompt-green" />
              Saved
            </span>
          )}
        </div>
        {!skill.editable && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-smoked-onyx px-4 py-3 text-body-sm text-pale-stone">
            Everyone in {user.org.name} uses this skill, so only org admins edit it.
            <button
              type="button"
              onClick={duplicate}
              className="text-warm-off-white underline-offset-2 outline-none hover:underline focus-visible:underline"
            >
              Duplicate it to make your own
            </button>
          </p>
        )}
        {error && <p className="text-body-sm text-traffic-red">{error}</p>}
      </header>

      <SkillReader draft={skill} />

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${skill.name}?`}
        description="Investigations stop seeing it immediately. Past answers that used it keep their record."
        confirmLabel="Delete"
        destructive
        onConfirm={() => void remove()}
      />
    </SkillPageFrame>
  );
}
