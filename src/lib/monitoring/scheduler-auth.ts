import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Shared-secret auth for `/api/internal/*`. The scheduler is a Kubernetes
 * CronJob, so there is no session cookie to present — and because the endpoint
 * spends money (each tick can start LLM investigations), it must not be
 * callable by anything that can merely reach the Service.
 */

export const SCHEDULER_HEADER = "x-drill-scheduler-secret";

export function schedulerSecret(): string {
  return process.env.SCHEDULER_SECRET?.trim() ?? "";
}

/**
 * `null` when the request is authorised, otherwise the Response to return.
 * Absent config = 404: the surface simply does not exist until an operator
 * configures a secret, rather than existing in an open state.
 */
export function checkSchedulerAuth(request: Request): Response | null {
  const expected = schedulerSecret();
  if (!expected)
    return Response.json({ error: "Not found" }, { status: 404 });

  const presented = request.headers.get(SCHEDULER_HEADER) ?? "";
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on length mismatch, which is itself a signal — so
  // compare lengths first and always run the constant-time check on equal
  // lengths only.
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return null;
}
