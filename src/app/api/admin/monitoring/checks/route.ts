import { writeAudit } from "@/lib/db/admin-queries";
import { createCheck, getCatalogueCheck } from "@/lib/db/monitoring-queries";
import { catalogueCaller } from "@/lib/monitoring/access";
import { ensureBuiltinChecks, checkSummaries, toCheckView } from "@/lib/monitoring/checks";
import { parseCheckInput, validateCheckId } from "@/lib/monitoring/check-input";

/** The caller's catalogue: their org's effective rubric, or the templates. */
export async function GET(request: Request) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  // Seeds the built-in rubric on first call, so an empty database still serves
  // a full catalogue. Returns the client-facing shape (no created_by etc.).
  return Response.json({ checks: await checkSummaries(caller.owner) });
}

/**
 * Add a check: the org's own (default) or, in the templates, one every org
 * inherits. The ID is chosen once and can never change, and it must be free in
 * the caller's catalogue — an org cannot shadow a template by creating a check
 * with its ID (it edits the template instead, which forks it).
 */
export async function POST(request: Request) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const { ctx, owner } = caller;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let id: string;
  let input;
  try {
    id = validateCheckId(body.id);
    input = parseCheckInput(body);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid check" },
      { status: 400 },
    );
  }

  // Seed first: otherwise the very first custom check could collide with a
  // built-in ID that has not been inserted yet.
  await ensureBuiltinChecks();
  if (await getCatalogueCheck(owner, id))
    return Response.json(
      { error: `A check with ID ${id} already exists`, field: "id" },
      { status: 409 },
    );

  const check = await createCheck(owner, { id, ...input }, ctx.userId);
  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: "monitoring.check.created",
    metadata: {
      checkId: id,
      category: input.category,
      title: input.title,
      scope: owner === null ? "template" : "org",
    },
  });
  return Response.json(toCheckView(check), { status: 201 });
}
