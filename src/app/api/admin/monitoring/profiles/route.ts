import { forbidden, getAdminActor } from "@/lib/auth/session";
import { playbookViews } from "@/lib/monitoring/playbooks";

/**
 * The live playbooks, as readable and editable data.
 *
 * Served from an API rather than imported by the page for two reasons: the
 * browser should not download every method and every check definition to render
 * one of them, and — since the methods are now database rows — the page could not
 * import them anyway. What it returns is the same object the prompt is built
 * from, which is what lets this screen be trusted as documentation.
 *
 * Each entry also carries when it was last edited (`editedAt`, null while it is
 * still the shipped text) and how many readings each observation key already has
 * (`readings`), so the editor can show drift and refuse a rename that would
 * orphan a trend.
 */
export async function GET() {
  if (!(await getAdminActor())) return forbidden();
  // Seeds the shipped methods on first read, so an empty database still serves a
  // full set of playbooks — same contract as the check catalogue.
  return Response.json({ profiles: await playbookViews() });
}
