import { ADMIN_HOME, CHAT_HOME, isAdminPath } from "@/lib/routes";

/**
 * Where to land after the active org changes. Never the current page: its ids
 * (a conversation, a cluster) belong to the org being left and would 404.
 */
function homeFor(pathname: string): string {
  return isAdminPath(pathname) ? ADMIN_HOME : CHAT_HOME;
}

/**
 * A FULL navigation, not router.push: the session, the workspace's agents and
 * every cached list are the old org's, and the server layout re-resolves them
 * only on a real request.
 */
export function reloadInto(pathname: string): void {
  window.location.assign(homeFor(pathname));
}

/** JSON request that throws the API's own `error` message on failure. */
export async function sendJson(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

export async function switchOrg(orgId: string, pathname: string): Promise<void> {
  await sendJson("/api/orgs/active", { orgId });
  reloadInto(pathname);
}
