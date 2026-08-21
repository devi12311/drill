import { forbidden, getAdminActor } from "@/lib/auth/session";
import { latestRunStatus } from "@/lib/db/monitoring-queries";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Is this job's most recent run still going, and did it fail?
 *
 * Exists purely so "Run now" has something cheap to poll. The button used to poll
 * `GET /api/admin/monitoring/jobs/[id]`, which returns the job, its twenty most
 * recent runs and every check override — four queries and a few kilobytes — every
 * five seconds for as long as a run lasts. This is one indexed query and a couple
 * of dozen bytes.
 */
export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  return Response.json(await latestRunStatus(id));
}
