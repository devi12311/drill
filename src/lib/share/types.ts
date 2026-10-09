import type { ArtifactDraft } from "@/lib/artifacts/types";
import type { SkillDraft } from "@/lib/skills/types";

/**
 * Share links (docs/DECISIONS.md — "Share links"): a frozen copy of a skill or
 * resolution that whoever holds the link may review, edit and import into their
 * own org. Client-safe — the share dialog, the review page and the API agree on
 * these shapes.
 */

export const SHARE_KINDS = ["skill", "resolution"] as const;
export type ShareKind = (typeof SHARE_KINDS)[number];

/**
 * `org`: only members of the org that shared it (any member may create one for a
 * skill they wrote). `any`: any signed-in Drill user — crossing the tenant line
 * is an org admin's call.
 */
export const SHARE_AUDIENCES = ["org", "any"] as const;
export type ShareAudience = (typeof SHARE_AUDIENCES)[number];

export const SHARE_EXPIRY_DAYS = [7, 30, 90] as const;
export const DEFAULT_SHARE_EXPIRY_DAYS = 30;

export type SharePayload =
  | { kind: "skill"; draft: SkillDraft }
  | { kind: "resolution"; draft: ArtifactDraft };

/** What a link is listed as: a skill's slug, a resolution's title. */
export function payloadTitle(payload: SharePayload): string {
  return payload.kind === "skill" ? payload.draft.name : payload.draft.title;
}

/**
 * Where an imported row came from. Copied as text when it is imported: the
 * receiving org never reads the source org's tables, and the badge survives the
 * source org being deleted.
 */
export interface ImportedFrom {
  linkId: string;
  orgName: string;
  author: string | null;
  sharedAt: string;
}

export type RedemptionStatus = "imported" | "declined";

/** A link as its org sees it (the item's Share dialog, Org settings). */
export interface ShareLinkView {
  id: string;
  kind: ShareKind;
  audience: ShareAudience;
  title: string;
  sourceId: string | null;
  createdByName: string | null;
  createdAt: string;
  expiresAt: string;
  imported: number;
  declined: number;
  /**
   * Who acted on it — `org` links only. Across orgs the sharer sees counts, never
   * the other org's usernames.
   */
  people: { username: string; status: RedemptionStatus }[] | null;
}
