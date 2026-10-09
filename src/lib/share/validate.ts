import { assertArtifactSize, validateDraft } from "@/lib/artifacts/types";
import { validateSkillDraft } from "@/lib/skills/types";
import { stripArtifactCitations } from "./scan";
import { SHARE_AUDIENCES, SHARE_EXPIRY_DAYS, SHARE_KINDS, type ShareAudience, type ShareKind, type SharePayload } from "./types";

/**
 * A draft that crosses the org line, in either direction (the sharer's edited
 * snapshot, the recipient's edited copy): the editor's own rules, plus the size
 * caps and citation stripping a foreign artifact needs. Throws a 400 message.
 */
export function validateSharePayload(kind: ShareKind, raw: unknown): SharePayload {
  if (kind === "skill") return { kind, draft: validateSkillDraft(raw) };
  const draft = stripArtifactCitations(validateDraft(raw));
  assertArtifactSize(draft);
  return { kind, draft };
}

export const isShareKind = (v: unknown): v is ShareKind =>
  SHARE_KINDS.includes(v as ShareKind);

export const isShareAudience = (v: unknown): v is ShareAudience =>
  SHARE_AUDIENCES.includes(v as ShareAudience);

export const isShareExpiry = (v: unknown): v is (typeof SHARE_EXPIRY_DAYS)[number] =>
  SHARE_EXPIRY_DAYS.includes(v as (typeof SHARE_EXPIRY_DAYS)[number]);
