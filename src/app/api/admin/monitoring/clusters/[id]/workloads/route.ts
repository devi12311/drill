import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  getClusterSummary,
  setWorkloadTechnology,
} from "@/lib/db/monitoring-queries";
import { asTechnology } from "@/lib/monitoring/technology";
import { WORKLOAD_KINDS, WORKLOAD_TECHNOLOGIES } from "@/lib/monitoring/types";
import type { WorkloadKind } from "@/lib/monitoring/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

/**
 * Correct a workload's technology by hand.
 *
 * Detection reads images, labels and container names, which is enough for anything
 * running an off-the-shelf image and useless for a service built from a private
 * base image. Rather than guess confidently, the platform records the guess and its
 * reasoning and lets an admin overrule it — and the override is stored separately so
 * the next discovery cannot revert it.
 *
 * Send `technology: null` to drop the override and go back to whatever detection
 * says.
 */
export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const cluster = await getClusterSummary(id);
  if (!cluster) return Response.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const kind = typeof body.kind === "string" ? body.kind.toLowerCase() : "";
  const namespace =
    typeof body.namespace === "string" ? body.namespace.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (
    !(WORKLOAD_KINDS as readonly string[]).includes(kind) ||
    !namespace ||
    !name
  )
    return Response.json(
      { error: "kind, namespace and name are required" },
      { status: 400 },
    );

  // Explicit null clears the override; anything else must be in the vocabulary.
  const clearing = body.technology === null || body.technology === "";
  const technology = clearing ? null : asTechnology(body.technology);
  if (!clearing && !technology)
    return Response.json(
      {
        error: `technology must be null or one of: ${WORKLOAD_TECHNOLOGIES.join(", ")}`,
      },
      { status: 400 },
    );

  const target = { kind: kind as WorkloadKind, namespace, name };
  if (!(await setWorkloadTechnology(id, target, technology)))
    return Response.json(
      { error: "That workload is not in this cluster's inventory" },
      { status: 404 },
    );

  await writeAudit({
    actorId: actor.id,
    action: "monitoring.workload.technology_set",
    metadata: { clusterId: id, ...target, technology },
  });
  return Response.json({ ok: true, technology });
}
