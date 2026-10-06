import { writeAudit } from "@/lib/db/admin-queries";
import {
  deleteOrgPlaybook,
  observedKeyCounts,
  savePlaybook,
} from "@/lib/db/monitoring-queries";
import { catalogueCaller } from "@/lib/monitoring/access";
import {
  parsePlaybookPatch,
  unacknowledgedKeyLosses,
} from "@/lib/monitoring/playbook-input";
import {
  cataloguePlaybook,
  EMPTY_METHOD,
  playbookView,
  toPlaybook,
} from "@/lib/monitoring/playbooks";
import type { CatalogueOwner } from "@/lib/db/monitoring-queries";
import { isKnownTechnology } from "@/lib/monitoring/workload-types-live";

// Next 16: route params are async.
type Context = { params: Promise<{ technology: string }> };

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

/** The route's technology, if it is one `owner` knows — a workload type or the cluster. */
async function technologyOf(
  context: Context,
  owner: CatalogueOwner,
): Promise<string | null> {
  const technology = (await context.params).technology.toLowerCase();
  return (await isKnownTechnology(owner, technology)) ? technology : null;
}

/**
 * One method in full, as the caller's catalogue has it — what the panel loads
 * when a tile is opened. For an org's fork it also carries the template, so the
 * panel can show what changed upstream.
 */
export async function GET(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const technology = await technologyOf(context, caller.owner);
  if (!technology) return notFound();
  const profile = await playbookView(caller.owner, technology);
  if (!profile) return notFound();
  return Response.json({ profile });
}

/**
 * Edit a method. In an org's catalogue the first edit FORKS the template into
 * the org's own copy (decision 126); in the templates (platform admins) it edits
 * what every org without a fork runs, and bumps the template's version so the
 * orgs that have forked it are told.
 *
 * A workload type with no method yet gets its FIRST one through the same PATCH
 * (decision 128): there is nothing to fork, so it is written as the caller's own —
 * the org's, or a template in the templates scope.
 */
export async function PATCH(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const { ctx, owner } = caller;
  const technology = await technologyOf(context, owner);
  if (!technology) return notFound();
  const row = await cataloguePlaybook(owner, technology);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let after;
  try {
    after = parsePlaybookPatch(body, row ? toPlaybook(row) : EMPTY_METHOD(technology));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid playbook" },
      { status: 400 },
    );
  }

  const before = row?.observations ?? [];
  const readings = await observedKeyCounts(
    before.map((spec) => spec.key),
    owner,
  );
  const dropped = before
    .filter(
      (spec) =>
        !after.observations.some((kept) => kept.key === spec.key) &&
        (readings[spec.key] ?? 0) > 0,
    )
    .map((spec) => ({ key: spec.key, readings: readings[spec.key] ?? 0 }));

  // A rename and a delete-plus-add look identical in a payload, so the only
  // enforceable rule is that a key with history cannot leave without being named.
  const unacknowledged = unacknowledgedKeyLosses(
    before,
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

  await savePlaybook(
    owner,
    technology,
    row,
    {
      framing: after.framing,
      dataSources: after.dataSources,
      method: after.method,
      observations: after.observations,
    },
    ctx.userId,
  );

  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: "monitoring.playbook.updated",
    metadata: {
      technology,
      scope: owner === null ? "template" : "org",
      forked: owner !== null && row?.source === "template" ? true : undefined,
      created: row ? undefined : true,
      droppedKeys: dropped.length > 0 ? dropped.map((d) => d.key) : undefined,
    },
  });

  return Response.json({
    technology,
    /** Keys whose trend ends here, so the UI can say so rather than lose it quietly. */
    droppedKeys: dropped,
  });
}

/**
 * Reset to template: drop the org's fork, so it runs the template again. Only an
 * org's own copy can go — a template is never deleted, for the reason PATCH gives.
 */
export async function DELETE(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const { ctx, owner } = caller;
  const technology = await technologyOf(context, owner);
  if (!technology) return notFound();
  if (owner === null)
    return Response.json(
      { error: "A template playbook cannot be deleted — every deep run of that engine depends on it." },
      { status: 409 },
    );
  if (!(await deleteOrgPlaybook(owner, technology)))
    return Response.json(
      { error: "This organization has no playbook of its own for this technology." },
      { status: 409 },
    );
  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: "monitoring.playbook.reset",
    metadata: { technology },
  });
  return Response.json({ ok: true });
}
