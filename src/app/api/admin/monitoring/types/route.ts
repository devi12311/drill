import { writeAudit } from "@/lib/db/admin-queries";
import { createWorkloadType } from "@/lib/db/monitoring-queries";
import { catalogueCaller } from "@/lib/monitoring/access";
import {
  parseWorkloadTypeDraft,
  validateWorkloadTypeSlug,
} from "@/lib/monitoring/workload-types";
import { liveWorkloadTypes, workloadTypeViews } from "@/lib/monitoring/workload-types-live";

/** The caller's workload types: their org's effective set, or the templates. */
export async function GET(request: Request) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  return Response.json({ types: await workloadTypeViews(caller.owner) });
}

/**
 * A new type — the org's own, or (templates scope) one every org inherits. The
 * slug is chosen once and never changes: workloads, check scopes and playbooks all
 * store it. It must be free in the caller's view, so an org cannot shadow a
 * template by re-creating its slug (it customizes the template instead).
 */
export async function POST(request: Request) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const { ctx, owner } = caller;
  let slug: string;
  let draft;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    slug = validateWorkloadTypeSlug(body.slug);
    draft = parseWorkloadTypeDraft(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid workload type" },
      { status: 400 },
    );
  }
  if ((await liveWorkloadTypes(owner)).some((t) => t.slug === slug))
    return Response.json(
      { error: `A workload type "${slug}" already exists`, field: "slug" },
      { status: 409 },
    );
  await createWorkloadType(owner, { slug, ...draft }, ctx.userId);
  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: "monitoring.workload_type.created",
    metadata: { slug, scope: owner === null ? "template" : "org" },
  });
  return Response.json({ slug }, { status: 201 });
}
