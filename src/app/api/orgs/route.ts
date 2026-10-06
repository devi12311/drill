import { getAuthUser, setActiveOrg, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { createOrgWithOwner } from "@/lib/db/org-queries";
import { validateOrgName } from "@/lib/orgs/types";

/**
 * POST /api/orgs — body { name }. A new org owned by the caller, made active.
 * Takes the bare user, not an org context: someone who belongs to no org (left
 * or removed from their last one) must still be able to start over.
 */
export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  let name: string;
  try {
    name = validateOrgName((await request.json())?.name);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid JSON body" },
      { status: 400 },
    );
  }
  const orgId = await createOrgWithOwner(name, user.id);
  await setActiveOrg(orgId);
  await writeAudit({ actorId: user.id, orgId, action: "org.created", metadata: { name } });
  return Response.json({ id: orgId, name }, { status: 201 });
}
