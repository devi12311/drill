import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import { createCheck, getCheckRow } from "@/lib/db/monitoring-queries";
import { checkSummaries, liveChecks } from "@/lib/monitoring/checks";
import { parseCheckInput, validateCheckId } from "@/lib/monitoring/check-input";

export async function GET() {
  if (!(await getAdminActor())) return forbidden();
  // Seeds the built-in rubric on first call, so an empty database still serves
  // a full catalogue. Returns the client-facing shape (no created_by etc.).
  return Response.json({ checks: await checkSummaries() });
}

/** Add a custom check. The ID is chosen once and can never change. */
export async function POST(request: Request) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();

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
  await liveChecks();
  if (await getCheckRow(id))
    return Response.json(
      { error: `A check with ID ${id} already exists`, field: "id" },
      { status: 409 },
    );

  const check = await createCheck({ id, ...input }, actor.id);
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.check.created",
    metadata: { checkId: id, category: input.category, title: input.title },
  });
  return Response.json(check, { status: 201 });
}
