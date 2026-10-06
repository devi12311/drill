import { writeAudit } from "@/lib/db/admin-queries";
import {
  deleteOrgWorkloadType,
  deleteTemplateWorkloadType,
  getCatalogueWorkloadType,
  saveWorkloadType,
} from "@/lib/db/monitoring-queries";
import { catalogueCaller } from "@/lib/monitoring/access";
import { parseWorkloadTypeDraft } from "@/lib/monitoring/workload-types";
import { ensureWorkloadTypes, toWorkloadTypeView } from "@/lib/monitoring/workload-types-live";

type Context = { params: Promise<{ slug: string }> };

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

async function load(request: Request, context: Context) {
  const caller = await catalogueCaller(request);
  if (caller instanceof Response) return { response: caller } as const;
  await ensureWorkloadTypes();
  const row = await getCatalogueWorkloadType(
    caller.owner,
    (await context.params).slug.toLowerCase(),
  );
  return { ...caller, row } as const;
}

/** One type as the caller sees it; an org's fork also carries its template. */
export async function GET(request: Request, context: Context) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  if (!loaded.row) return notFound();
  return Response.json({
    type: toWorkloadTypeView(loaded.row),
    template: loaded.row.template
      ? toWorkloadTypeView({ ...loaded.row.template, source: "template", updateAvailable: false, templateVersion: null, template: null })
      : null,
  });
}

/**
 * Edit a type. In an org's catalogue the first edit of a template FORKS it (as
 * with checks and playbooks); in the templates it changes every org without a
 * fork, and bumps the version so forks are told. Rules take effect at the next
 * discovery — the screen offers a rescan.
 */
export async function PATCH(request: Request, context: Context) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  const { ctx, owner, row } = loaded;
  if (!row) return notFound();
  let draft;
  try {
    draft = parseWorkloadTypeDraft((await request.json()) as Record<string, unknown>, row);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid workload type" },
      { status: 400 },
    );
  }
  await saveWorkloadType(owner, row, draft, ctx.userId);
  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: "monitoring.workload_type.updated",
    metadata: {
      slug: row.slug,
      scope: owner === null ? "template" : "org",
      forked: owner !== null && row.source === "template" ? true : undefined,
    },
  });
  return Response.json({ ok: true });
}

/**
 * Org scope: reset a customized type to its template, or delete the org's own
 * type. Templates scope: delete a custom template. Shipped templates are
 * disable-only. Workloads already labelled with a deleted type keep the label
 * until the next rescan; checks scoped to it simply stop matching.
 */
export async function DELETE(request: Request, context: Context) {
  const loaded = await load(request, context);
  if ("response" in loaded) return loaded.response;
  const { ctx, owner, row } = loaded;
  if (!row) return notFound();
  if (owner !== null && row.source === "template")
    return Response.json(
      { error: "This type comes from the shared catalogue. Disable it for your organization instead." },
      { status: 409 },
    );
  if (owner === null && row.builtin)
    return Response.json(
      { error: "Shipped workload types cannot be deleted, only disabled." },
      { status: 409 },
    );
  if (owner === null) await deleteTemplateWorkloadType(row.slug);
  else await deleteOrgWorkloadType(owner, row.slug);
  await writeAudit({
    actorId: ctx.userId,
    orgId: owner,
    action: row.source === "override" ? "monitoring.workload_type.reset" : "monitoring.workload_type.deleted",
    metadata: { slug: row.slug },
  });
  return Response.json({ ok: true });
}
