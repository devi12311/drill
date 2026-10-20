import "server-only";
import { notFound } from "next/navigation";
import { forbidden, getConsoleContext, type ConsoleContext } from "@/lib/auth/session";
import { gitModuleEnabled } from "./gateway";

/**
 * The gate for every /api/admin/git route: the console context (org owners and
 * admins, impersonation ignored — the proxy already blocks writes while
 * impersonating outside /api/admin), and the module actually configured. Returns
 * the Response to send when refused.
 */
export async function gitApiContext(): Promise<ConsoleContext | Response> {
  const ctx = await getConsoleContext();
  if (!ctx) return forbidden();
  if (!gitModuleEnabled()) {
    return Response.json({ error: "The Git module is not configured on this Drill install" }, { status: 404 });
  }
  return ctx;
}

/** The one answer for "not yours" and "not there" alike. */
export function gitNotFound(): Response {
  return Response.json({ error: "Not found" }, { status: 404 });
}

/** Parse a JSON body, or the 400 to send. */
export async function jsonBody<T>(request: Request): Promise<T | Response> {
  try {
    return (await request.json()) as T;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export function unprocessable(error: string, field?: string): Response {
  return Response.json({ error, ...(field ? { field } : {}) }, { status: 422 });
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The same gate for the server-rendered Git pages (the admin layout already turned non-admins away). */
export async function gitPageContext(): Promise<ConsoleContext> {
  const ctx = await getConsoleContext();
  if (!ctx) notFound();
  return ctx;
}
