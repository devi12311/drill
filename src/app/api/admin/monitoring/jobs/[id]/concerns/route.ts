import { forbidden, getAdminActor } from "@/lib/auth/session";
import { getJob, listConcerns } from "@/lib/db/monitoring-queries";
import { checkSummaries } from "@/lib/monitoring/checks";
import {
  CONCERN_STATUSES,
  SEVERITIES,
  type ConcernStatus,
  type Severity,
} from "@/lib/monitoring/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/** Comma-separated filter param, narrowed to the legal values. */
function parseList<T extends string>(
  raw: string | null,
  allowed: readonly T[],
): T[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter((v): v is T => (allowed as readonly string[]).includes(v));
  return values.length > 0 ? values : undefined;
}

export async function GET(request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  /**
   * All reads fire together, and the existence check happens after.
   *
   * They have no data dependency on each other — only the 404 did, and paying
   * three sequential round-trips to save two cheap queries on the one request
   * that 404s is the wrong trade. A missing id makes the others return empty.
   */
  const [job, concerns, checks] = await Promise.all([
    getJob(id),
    listConcerns(id, {
      statuses: parseList<ConcernStatus>(params.get("status"), CONCERN_STATUSES),
      severities: parseList<Severity>(params.get("severity"), SEVERITIES),
    }),
    // Check titles/citations travel with the concerns so the client never needs
    // to import the catalogue (it is live data now, not a constant).
    checkSummaries(),
  ]);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ job, concerns, checks });
}
