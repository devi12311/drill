import { writeAudit } from "@/lib/db/admin-queries";
import { addRepositories, getConnectionSecrets, type NewRepository } from "@/lib/db/git-queries";
import { errorText, gitApiContext, gitNotFound, jsonBody, unprocessable } from "@/lib/git/access";
import { pushManifestSoon } from "@/lib/git/manifest";
import { isFullName, PROVIDERS } from "@/lib/git/providers";
import { isBranchName, isRepoName } from "@/lib/git/types";

/** One picker submission; more than this is a scripted bulk import, not a click. */
const MAX_PER_REQUEST = 50;

/**
 * Add picked repositories to a connection; each one's default branch is queued
 * for its first sync at once. The browser sends only names — clone URLs and
 * default branches are re-read from the provider, never taken from the request.
 */
export async function POST(request: Request) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const body = await jsonBody<{ connectionId?: string; fullNames?: unknown }>(request);
  if (body instanceof Response) return body;
  const connection = body.connectionId ? await getConnectionSecrets(ctx.orgId, body.connectionId) : null;
  if (!connection) return gitNotFound();

  const fullNames = Array.isArray(body.fullNames) ? [...new Set(body.fullNames)] : [];
  if (!fullNames.length || fullNames.length > MAX_PER_REQUEST) {
    return unprocessable(`Pick between 1 and ${MAX_PER_REQUEST} repositories`, "fullNames");
  }
  // Each must live under the connection's own account: the token is scoped to it.
  const owner = connection.account.toLowerCase();
  if (!fullNames.every((n) => isFullName(n) && n.split("/")[0].toLowerCase() === owner)) {
    return unprocessable(`Repositories must belong to ${connection.account}`, "fullNames");
  }

  const provider = PROVIDERS[connection.provider];
  const fetched = await Promise.allSettled(fullNames.map((n) => provider.getRepo(connection, n as string)));
  const repos: NewRepository[] = [];
  const skipped: { fullName: string; reason: string }[] = [];
  fetched.forEach((r, i) => {
    const fullName = fullNames[i] as string;
    if (r.status === "rejected") skipped.push({ fullName, reason: errorText(r.reason) });
    // Git allows names the gateway refuses (and an unindexable default branch would
    // make the repo useless): say so now rather than fail every sync later.
    else if (!isBranchName(r.value.defaultBranch)) {
      skipped.push({ fullName, reason: `its default branch "${r.value.defaultBranch}" has characters the code index does not accept` });
    } else if (!isRepoName(r.value.name)) skipped.push({ fullName, reason: "its name has characters the code index does not accept" });
    else repos.push(r.value);
  });

  const result = await addRepositories(ctx, connection.id, repos);
  if (result.added.length) {
    pushManifestSoon(ctx.orgId);
    await writeAudit({
      actorId: ctx.userId,
      orgId: ctx.orgId,
      action: "git.repositories.added",
      metadata: { connectionId: connection.id, repositories: result.added.map((r) => r.name) },
    });
  }
  return Response.json({ added: result.added, skipped: [...skipped, ...result.skipped] }, { status: 201 });
}
