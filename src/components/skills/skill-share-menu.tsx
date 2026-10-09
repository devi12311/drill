"use client";

import { useState } from "react";
import { ChevronDown, Link2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ShareDialog } from "@/components/share/share-dialog";
import { useSession } from "@/components/session/session-provider";
import { sendJson } from "@/lib/http";
import type { ShareAudience } from "@/lib/share/types";
import { toSkillDraft, type SkillView } from "@/lib/skills/types";

type Reach = "private" | "shared" | "always-on";

const reachOf = (skill: SkillView): Reach => (skill.alwaysOn ? "always-on" : skill.visibility);

/** Rough, and labelled as such: ~4 characters a token for English prose. */
function tokensFor(body: string): string {
  const tokens = Math.ceil(body.length / 4);
  return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
}

const PATCH: Record<Reach, { visibility: "private" | "shared"; alwaysOn: boolean }> = {
  private: { visibility: "private", alwaysOn: false },
  shared: { visibility: "shared", alwaysOn: false },
  "always-on": { visibility: "shared", alwaysOn: true },
};

/**
 * Who a link may go to. A colleague link is pointless once the skill is
 * org-wide (they already have the original), and only an admin sends outside
 * the org (decision 140).
 */
export function linkAudiences(skill: SkillView, isOrgAdmin: boolean, isAuthor: boolean): ShareAudience[] {
  if (!isOrgAdmin && !isAuthor) return [];
  const org: ShareAudience[] = skill.visibility === "shared" ? [] : ["org"];
  return isOrgAdmin ? [...org, "any"] : org;
}

/**
 * Share ▾ — the one place a skill reaches further, with the two meanings kept
 * apart: who in the org uses *this* skill (org admins decide; the change is
 * confirmed, saved at once and audited), and sending a *copy* by link.
 * Sharing used to be a header button and two checkboxes at the foot of the
 * form, saved on tick while the rest of the form waited for Save.
 */
export function SkillShareMenu({
  skill,
  isAuthor,
  onChanged,
  onError,
  onEditSkill,
}: {
  skill: SkillView;
  isAuthor: boolean;
  onChanged: (skill: SkillView) => void;
  onError: (message: string | null) => void;
  /** Leave the share dialog for the editor — to edit out what should not leave the org. */
  onEditSkill?: () => void;
}) {
  const { user } = useSession();
  const orgName = user.org.name;
  const isOrgAdmin = user.isOrgAdmin;
  const [pending, setPending] = useState<Reach | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const reach = reachOf(skill);
  const audiences = linkAudiences(skill, isOrgAdmin, isAuthor);
  if (!isOrgAdmin && audiences.length === 0) return null;

  // Someone other than you, when it is someone named: they are who a change affects.
  const author = skill.createdByName && skill.createdBy !== user.id ? `@${skill.createdByName}` : null;
  const owner = skill.createdBy === user.id ? "you" : (author ?? "its author");
  const tokens = tokensFor(skill.body);

  async function apply(next: Reach) {
    onError(null);
    try {
      onChanged(await sendJson<SkillView>(`/api/skills/${skill.id}`, PATCH[next], "PATCH"));
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not change who uses it");
    }
  }

  // Say what changes for whom — the checkbox it replaces said none of it.
  const confirm: Record<Reach, { title: string; description: string; label: string }> = {
    shared: {
      title: `Make it available to everyone in ${orgName}?`,
      description: `Every member can run it, and Holmes may use it in anyone's investigation. From now on only org admins can edit it${author ? ` — ${author} included` : ""}.${reach === "always-on" ? " It stops going into every chat turn." : ""}`,
      label: "Make org-wide",
    },
    "always-on": {
      title: "Make it always-on?",
      description: `Its whole procedure goes into every chat turn for everyone in ${orgName} — about ${tokens} tokens each turn — instead of Holmes fetching it when it matches.${reach === "private" ? ` Only org admins can edit it from now on${author ? ` — ${author} included` : ""}.` : ""}`,
      label: "Make always-on",
    },
    private: {
      title: "Make it private again?",
      description: `Members stop seeing and using it; only ${owner} ${owner === "you" ? "keep" : "keeps"} it${author ? `, and ${author} can edit it again` : ""}.${reach === "always-on" ? " It also stops being always-on." : ""}`,
      label: "Make private",
    },
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="gap-1.5">
            <Share2 className="size-3.5" />
            Share
            <ChevronDown className="size-3.5 text-bone-gray" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel className="text-caption-tracked uppercase text-bone-gray">
            In {orgName}
          </DropdownMenuLabel>
          {isOrgAdmin ? (
            <DropdownMenuRadioGroup
              value={reach}
              onValueChange={(v) => v !== reach && setPending(v as Reach)}
            >
              <DropdownMenuRadioItem value="private">
                Only {owner}
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="shared">Everyone in {orgName}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="always-on">
                <span>
                  Everyone, always-on
                  <span className="block text-[12px] text-bone-gray">
                    in every chat turn · ~{tokens} tokens
                  </span>
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          ) : (
            <p className="px-2 pb-2 text-body-sm text-bone-gray">
              {reach === "private"
                ? "Private to you. Only an org admin can make it available to everyone."
                : `Everyone in ${orgName} uses it.`}
            </p>
          )}
          {audiences.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-caption-tracked uppercase text-bone-gray">
                By link — sends a copy
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => setLinkOpen(true)}>
                <Link2 className="size-4" />
                Send a copy…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {pending && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={confirm[pending].title}
          description={confirm[pending].description}
          confirmLabel={confirm[pending].label}
          onConfirm={() => void apply(pending)}
        />
      )}
      {audiences.length > 0 && (
        <ShareDialog
          sourceId={skill.id}
          payload={{ kind: "skill", draft: toSkillDraft(skill) }}
          audiences={audiences}
          open={linkOpen}
          onOpenChange={setLinkOpen}
          onEditSource={onEditSkill}
        />
      )}
    </>
  );
}
