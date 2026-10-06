import { forbidden, getAuthContext, unauthorized } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { renameOrg } from "@/lib/db/org-queries";
import { validateOrgName } from "@/lib/orgs/types";

/** PATCH /api/org — body { name }. Rename the active org (org admins). */
export async function PATCH(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!ctx.isOrgAdmin) return forbidden();
  let name: string;
  try {
    name = validateOrgName((await request.json())?.name);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid JSON body" },
      { status: 400 },
    );
  }
  await renameOrg(ctx.orgId, name);
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "org.renamed",
    metadata: { from: ctx.orgName, to: name },
  });
  return Response.json({ name });
}
