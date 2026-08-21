import { forbidden, getAdminActor } from "@/lib/auth/session";
import {
  getRun,
  getRunFindings,
  getRunObservations,
} from "@/lib/db/monitoring-queries";
import { checkSummaries } from "@/lib/monitoring/checks";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  /**
   * All reads fire together, and the existence check happens after.
   *
   * They have no data dependency on each other — only the 404 did, and paying
   * three sequential round-trips to save two cheap queries on the one request
   * that 404s is the wrong trade. A missing id makes the others return empty.
   */
  const [run, findings, observations, checks] = await Promise.all([
    getRun(id),
    getRunFindings(id),
    getRunObservations(id),
    // The catalogue travels with the run so the UI can name and cite a check
    // (including ones that only appear in `coverage.skipped`, and custom ones).
    checkSummaries(),
  ]);
  if (!run) return Response.json({ error: "Not found" }, { status: 404 });

  // What the run was SUPPOSED to measure, sent alongside what it did measure so the
  // page can name the missing readings — a measurement that never came back is the
  // whole reason observations exist, and it is invisible from the data alone.
  //
  // Taken from the run's own snapshot and never re-derived: methods are editable, so
  // today's playbook would grade an old run against questions it was never asked. A
  // run older than the column shows no measurement panel, which is the honest answer.
  const expected = run.expectedObservations ?? [];

  return Response.json({ run, findings, observations, expected, checks });
}
