import "server-only";
import { notFound } from "next/navigation";
import {
  forbidden,
  getConsoleContext,
  type AuthContext,
  type ConsoleContext,
} from "@/lib/auth/session";
import {
  monitoringOrgOf,
  type CatalogueOwner,
  type MonitoringRef,
} from "@/lib/db/monitoring-queries";
import { parseCatalogueScope, type CatalogueScope } from "./catalogue-scope";

/**
 * True when the entity exists AND belongs to the caller's org. Every monitoring
 * route and page addressed by an id goes through this before reading anything,
 * and answers a foreign id exactly like a missing one — another org's cluster
 * must not even be confirmable by guessing.
 */
export async function ownsMonitoring(
  ctx: AuthContext,
  ref: MonitoringRef,
): Promise<boolean> {
  return (await monitoringOrgOf(ref)) === ctx.orgId;
}

/** The one answer for "not yours" and "not there" alike. */
export function monitoringNotFound(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

/**
 * The same gate for the server-rendered monitoring pages: the admin's org
 * context, after proving every id in the URL is that org's (404 otherwise).
 */
export async function monitoringPageContext(
  ...refs: MonitoringRef[]
): Promise<ConsoleContext> {
  const ctx = await getConsoleContext();
  // The admin layout already turned non-admins away; this is the org half.
  if (!ctx) notFound();
  for (const ref of refs) {
    if (!(await ownsMonitoring(ctx, ref))) notFound();
  }
  return ctx;
}

/**
 * Whose catalogue a check/playbook request addresses (decision 126): the console
 * user's org by default, or — `?scope=templates`, platform admins only — the
 * templates every org inherits. Returns the Response to send when refused.
 */
export async function catalogueCaller(
  request: Request,
): Promise<{ ctx: ConsoleContext; owner: CatalogueOwner } | Response> {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  const scope = parseCatalogueScope(new URL(request.url).searchParams.get("scope"));
  if (scope === "templates" && !ctx.isPlatformAdmin) return forbidden();
  return { ctx, owner: scope === "templates" ? null : ctx.orgId };
}

/** The same choice for the catalogue pages, from their `?scope=` search param. */
export async function cataloguePageOwner(
  rawScope: string | undefined,
): Promise<{ owner: CatalogueOwner; scope: CatalogueScope; canEditTemplates: boolean }> {
  const ctx = await monitoringPageContext();
  const asked = parseCatalogueScope(rawScope);
  // A non-platform admin asking for templates simply gets their org's view.
  const scope = asked === "templates" && ctx.isPlatformAdmin ? "templates" : "org";
  return {
    owner: scope === "templates" ? null : ctx.orgId,
    scope,
    canEditTemplates: ctx.isPlatformAdmin,
  };
}
