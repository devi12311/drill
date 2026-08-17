import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  getPlaybookRow,
  observedKeyCounts,
  updatePlaybook,
} from "@/lib/db/monitoring-queries";
import {
  parsePlaybookPatch,
  unacknowledgedKeyLosses,
} from "@/lib/monitoring/playbook-input";
import { ensurePlaybooks, toPlaybook } from "@/lib/monitoring/playbooks";
import {
  WORKLOAD_TECHNOLOGIES,
  type WorkloadTechnology,
} from "@/lib/monitoring/types";

// Next 16: route params are async.
type Context = { params: Promise<{ technology: string }> };

/**
 * Edit a method. Edit and save is the whole lifecycle — there is no version, no
 * comparison against the shipped text and no adopt/decline dance; a row nobody has
 * edited keeps tracking the text in git via `seedPlaybooks`, and an edited one is
 * the operator's.
 *
 * There is deliberately no POST and no DELETE. A technology without a playbook is
 * also a technology without a `WORKLOAD_TECHNOLOGIES` entry and without detection
 * rules, so creating one here would produce a method nothing can ever be matched
 * to; and deleting one would silently downgrade every deep run of that engine to
 * the generic rubric, which is the failure this whole layer exists to fix.
 */
export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();

  const { technology: raw } = await context.params;
  const technology = raw.toLowerCase() as WorkloadTechnology;
  if (!(WORKLOAD_TECHNOLOGIES as readonly string[]).includes(technology))
    return Response.json({ error: "Not found" }, { status: 404 });

  // The row may not exist yet if nothing has read the playbooks in this process.
  await ensurePlaybooks();
  const row = await getPlaybookRow(technology);
  if (!row) return Response.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let after;
  try {
    after = parsePlaybookPatch(body, toPlaybook(row));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid playbook" },
      { status: 400 },
    );
  }

  const readings = await observedKeyCounts(
    row.observations.map((spec) => spec.key),
  );
  const dropped = row.observations
    .filter(
      (spec) =>
        !after.observations.some((kept) => kept.key === spec.key) &&
        (readings[spec.key] ?? 0) > 0,
    )
    .map((spec) => ({ key: spec.key, readings: readings[spec.key] ?? 0 }));

  // A rename and a delete-plus-add look identical in a payload, so the only
  // enforceable rule is that a key with history cannot leave without being named.
  const unacknowledged = unacknowledgedKeyLosses(
    row.observations,
    after.observations,
    readings,
    after.dropKeys,
  );
  if (unacknowledged.length > 0)
    return Response.json(
      {
        error: `${unacknowledged
          .map((k) => `${k.key} (${k.readings} reading${k.readings === 1 ? "" : "s"})`)
          .join(", ")} already ${
          unacknowledged.length === 1 ? "has" : "have"
        } measurements recorded. A key is the axis its trend is plotted on, so it cannot be renamed — add a new key instead, or remove this one explicitly to end its series.`,
        keys: unacknowledged.map((k) => k.key),
      },
      { status: 409 },
    );

  const updated = await updatePlaybook(technology, {
    framing: after.framing,
    dataSources: after.dataSources,
    method: after.method,
    observations: after.observations,
    // Marks the row as the operator's, which is also what stops a later release
    // overwriting it in `seedPlaybooks`.
    editedBy: actor.id,
  });
  if (!updated) return Response.json({ error: "Not found" }, { status: 404 });

  await writeAudit({
    actorId: actor.id,
    action: "monitoring.playbook.updated",
    metadata: {
      technology,
      droppedKeys: dropped.length > 0 ? dropped.map((d) => d.key) : undefined,
    },
  });

  return Response.json({
    technology,
    /** Keys whose trend ends here, so the UI can say so rather than lose it quietly. */
    droppedKeys: dropped,
  });
}
