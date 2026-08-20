import { forbidden, getAdminActor } from "@/lib/auth/session";
import { writeAudit } from "@/lib/db/admin-queries";
import {
  autoResolveConcernsForDisabledCheck,
  countConcernsForCheck,
  deleteCheck,
  getCheckRow,
  updateCheck,
  type CheckRow,
} from "@/lib/db/monitoring-queries";
import {
  isSemanticChange,
  parseCheckInput,
  type CheckInput,
} from "@/lib/monitoring/check-input";
import type { CheckRequirement } from "@/lib/monitoring/catalogue";
import type { TargetKind, WorkloadTechnology } from "@/lib/monitoring/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

function toInput(row: CheckRow): CheckInput {
  return {
    category: row.category,
    title: row.title,
    question: row.question,
    evidence: row.evidence,
    reference: row.reference,
    baseSeverity: row.baseSeverity,
    appliesTo: row.appliesTo as TargetKind[],
    appliesToTechnologies: row.appliesToTechnologies as WorkloadTechnology[],
    excludesTechnologies: row.excludesTechnologies as WorkloadTechnology[],
    requires: (row.requires as CheckRequirement | null) ?? null,
    resolveAfterAbsentRuns: row.resolveAfterAbsentRuns,
    enabled: row.enabled,
  };
}

export async function GET(_request: Request, context: Context) {
  if (!(await getAdminActor())) return forbidden();
  const { id } = await context.params;
  const check = await getCheckRow(id);
  if (!check) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({
    check,
    concernCount: await countConcernsForCheck(id),
  });
}

/**
 * Edit a check. The ID is never editable (concerns reference it by value), and
 * a change to what the check MEANS bumps its version so history stays readable.
 * Disabling it auto-resolves its open concerns — nothing else can close them,
 * because reconciliation never touches a concern whose check did not run.
 */
export async function PATCH(request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const existing = await getCheckRow(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.id === "string" && body.id.toUpperCase() !== id)
    return Response.json(
      {
        error:
          "A check's ID cannot be changed — concerns reference it by value, so renaming would orphan their history. Create a new check and disable this one instead.",
        field: "id",
      },
      { status: 400 },
    );

  const before = toInput(existing);
  let after: CheckInput;
  try {
    after = parseCheckInput(body, before);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid check" },
      { status: 400 },
    );
  }

  const bumped = isSemanticChange(before, after);
  const check = await updateCheck(id, {
    ...after,
    ...(bumped ? { version: existing.version + 1 } : {}),
  });
  if (!check) return Response.json({ error: "Not found" }, { status: 404 });

  let autoResolved = 0;
  if (before.enabled && !after.enabled)
    autoResolved = await autoResolveConcernsForDisabledCheck(id);

  await writeAudit({
    actorId: actor.id,
    action: after.enabled === false && before.enabled
      ? "monitoring.check.disabled"
      : "monitoring.check.updated",
    metadata: {
      checkId: id,
      builtin: existing.builtin,
      versionBumped: bumped ? check.version : undefined,
      autoResolved: autoResolved || undefined,
    },
  });
  return Response.json({ check, autoResolved });
}

/**
 * Delete a custom check. Built-ins are disable-only, and any check with concern
 * history is refused — the history references the ID by value and would be
 * orphaned. Disabling is always the safe alternative.
 */
export async function DELETE(_request: Request, context: Context) {
  const actor = await getAdminActor();
  if (!actor) return forbidden();
  const { id } = await context.params;
  const existing = await getCheckRow(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  if (existing.builtin)
    return Response.json(
      {
        error:
          "Built-in checks cannot be deleted, only disabled — they are re-seeded on every start.",
      },
      { status: 409 },
    );

  const concernCount = await countConcernsForCheck(id);
  if (concernCount > 0)
    return Response.json(
      {
        error: `${concernCount} concern(s) reference this check. Disable it instead — deleting would orphan that history.`,
      },
      { status: 409 },
    );

  await deleteCheck(id);
  await writeAudit({
    actorId: actor.id,
    action: "monitoring.check.deleted",
    metadata: { checkId: id, title: existing.title },
  });
  return Response.json({ ok: true });
}
