import { forbidden, getAdminActor } from "@/lib/auth/session";
import { playbookSummaries } from "@/lib/monitoring/playbooks";

/**
 * The live playbooks as a SHELF: one name and two counts each.
 *
 * It used to return every method in full — framing, data sources, ordered steps
 * and all ~325 observation specs — which was ~93 KB of JSON to render seven tiles
 * showing two integers, plus an `observedKeyCounts` group-by over every key of
 * every playbook on each load. The full text of one method is at
 * `GET /api/admin/monitoring/profiles/[technology]`, which is what the panel opens.
 *
 * Served from an API rather than imported by the page because the methods are
 * database rows, and what it returns is derived from the same object the prompt is
 * built from — which is what lets this screen be trusted as documentation.
 */
export async function GET() {
  if (!(await getAdminActor())) return forbidden();
  // Seeds the shipped methods on first read, so an empty database still serves a
  // full set of playbooks — same contract as the check catalogue.
  return Response.json({ profiles: await playbookSummaries() });
}
