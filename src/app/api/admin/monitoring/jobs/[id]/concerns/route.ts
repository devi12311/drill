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
  const job = await getJob(id);
  if (!job) return Response.json({ error: "Not found" }, { status: 404 });

  const params = new URL(request.url).searchParams;
  const concerns = await listConcerns(id, {
    statuses: parseList<ConcernStatus>(params.get("status"), CONCERN_STATUSES),
    severities: parseList<Severity>(params.get("severity"), SEVERITIES),
  });
  // Check titles/citations travel with the concerns so the client never needs
  // to import the catalogue (it is live data now, not a constant).
  return Response.json({ job, concerns, checks: await checkSummaries() });
}
