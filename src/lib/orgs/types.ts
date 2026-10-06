/**
 * Organization roles. Client-safe: the UI gates controls on the very values the
 * API checks. `users.role` stays the separate PLATFORM role (admin = operates
 * Drill itself: templates, every org's analytics, impersonation); these govern
 * what a member may do inside one org.
 */
export const ORG_ROLES = ["owner", "admin", "member"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/** Owners and admins manage the org's shared things (agents, clusters, shared skills). */
export function isOrgAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Who may change whom. Owners manage everyone; admins manage admins and members
 * but never an owner — otherwise an admin could demote the people who appointed
 * them. Members manage nobody (leaving is separate). The API enforces this; the
 * UI reads the same function to hide controls that would only 403.
 */
export function canManageMember(actor: OrgRole, target: OrgRole): boolean {
  if (actor === "owner") return true;
  return actor === "admin" && target !== "owner";
}

/** Roles an actor may hand out, by role change or by invitation. */
export function assignableRoles(actor: OrgRole): OrgRole[] {
  if (actor === "owner") return [...ORG_ROLES];
  if (actor === "admin") return ["admin", "member"];
  return [];
}

export const ORG_ROLE_LABEL: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/** Same bounds everywhere an org is named (signup default, create, rename). */
export const ORG_NAME_MAX = 80;

export function validateOrgName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new Error("Organization name is required");
  if (name.length > ORG_NAME_MAX)
    throw new Error(`Organization name: at most ${ORG_NAME_MAX} characters`);
  return name;
}

/** An org member as the members list shows them. */
export interface OrgMemberView {
  userId: string;
  username: string;
  role: OrgRole;
  joinedAt: string;
}

/** A pending invitation; the link itself is only ever shown once, at creation. */
export interface OrgInviteView {
  id: string;
  role: OrgRole;
  label: string | null;
  createdByName: string | null;
  expiresAt: string;
}
