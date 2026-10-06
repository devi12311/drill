import { writeAudit } from "@/lib/db/admin-queries";
import {
  autoResolveConcernsForDisabledCheck,
  countConcernsForCheck,
  deleteOrgCheck,
  deleteTemplateCheck,
  getCatalogueCheck,
  saveCheck,
  type CatalogueOwner,
  type CheckRow,
} from "@/lib/db/monitoring-queries";
import { catalogueCaller } from "@/lib/monitoring/access";
import {
  isSemanticChange,
  parseCheckInput,
  type CheckInput,
} from "@/lib/monitoring/check-input";
import { ensureBuiltinChecks, toCheckView } from "@/lib/monitoring/checks";
import type {
  CheckRequirement,
  TargetKind,
  WorkloadTechnology,
} from "@/lib/monitoring/types";

// Next 16: route params are async.
type Context = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

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

async function load(owner: CatalogueOwner, context: Context) {
  await ensureBuiltinChecks();
  return getCatalogueCheck(owner, (await context.params).id);
}

/** Where a disable stops the check: one org, or every org inheriting the template. */
const disabledScope = (owner: CatalogueOwner) =>
  owner === null ? ({ template: true } as const) : { orgId: owner };

/**
 * One check as the caller's catalogue has it. An org's fork also carries the
 * template it came from, so the panel can show what changed upstream.
 */
export async function GET(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const row = await load(caller.owner, context);
  if (!row) return notFound();
  return Response.json({
    check: toCheckView(row),
    template: row.template ? toCheckView(row.template) : null,
    concernCount: await countConcernsForCheck(row.id, caller.owner),
  });
}

/**
 * Edit a check. In an org's catalogue the first edit of a template FORKS it into
 * the org's own copy (decision 126); in the templates it changes what every org
 * without a fork runs. The ID is never editable (concerns reference it by value),
 * a change to what the check MEANS bumps its version so history stays readable,
 * and disabling auto-resolves the open concerns that can no longer be re-checked.
 */
export async function PATCH(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const { ctx, owner } = caller;
  const existing = await load(owner, context);
  if (!existing) return notFound();
  const id = existing.id;

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
  const saved = await saveCheck(
    owner,
    existing,
    { ...after, ...(bumped ? { version: existing.version + 1 } : {}) },
    ctx.userId,
  );

  let autoResolved = 0;
  if (before.enabled && !after.enabled)
    autoResolved = await autoResolveConcernsForDisabledCheck(id, disabledScope(owner));

  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action:
      after.enabled === false && before.enabled
        ? "monitoring.check.disabled"
        : "monitoring.check.updated",
    metadata: {
      checkId: id,
      scope: owner === null ? "template" : "org",
      forked: owner !== null && existing.source === "template" ? true : undefined,
      builtin: existing.builtin,
      versionBumped: bumped ? saved.version : undefined,
      autoResolved: autoResolved || undefined,
    },
  });
  return Response.json({ check: toCheckView(saved), autoResolved });
}

/**
 * In an org's catalogue: reset a customized template (drop the org's copy) or
 * delete the org's own check. In the templates: delete a custom template. A
 * built-in template is disable-only, and deleting a check that still has concern
 * history is refused — the history references the ID by value.
 */
export async function DELETE(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return caller;
  const { ctx, owner } = caller;
  const existing = await load(owner, context);
  if (!existing) return notFound();
  const id = existing.id;

  if (existing.source === "override") {
    await deleteOrgCheck(owner!, id);
    await writeAudit({
      actorId: ctx.userId,
      orgId: owner,
      action: "monitoring.check.reset",
      metadata: { checkId: id },
    });
    return Response.json({ ok: true, reset: true });
  }

  if (existing.builtin || (owner !== null && existing.source === "template"))
    return Response.json(
      {
        error:
          owner === null
            ? "Built-in checks cannot be deleted, only disabled — they are re-seeded on every start."
            : "This check comes from the shared catalogue. Disable it for your organization instead.",
      },
      { status: 409 },
    );

  const concernCount = await countConcernsForCheck(id, owner);
  if (concernCount > 0)
    return Response.json(
      {
        error: `${concernCount} concern(s) reference this check. Disable it instead — deleting would orphan that history.`,
      },
      { status: 409 },
    );

  if (owner === null) await deleteTemplateCheck(id);
  else await deleteOrgCheck(owner, id);
  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: "monitoring.check.deleted",
    metadata: { checkId: id, title: existing.title, scope: owner === null ? "template" : "org" },
  });
  return Response.json({ ok: true });
}
