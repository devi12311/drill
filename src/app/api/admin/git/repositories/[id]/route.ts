import { writeAudit } from "@/lib/db/admin-queries";
import { isUniqueViolation } from "@/lib/db";
import {
  addBranches,
  deleteRepository,
  getConnectionSecrets,
  getRepository,
  removeBranches,
  renameRepository,
} from "@/lib/db/git-queries";
import { errorText, gitApiContext, gitNotFound, jsonBody, unprocessable } from "@/lib/git/access";
import { pushManifestSoon } from "@/lib/git/manifest";
import { PROVIDERS } from "@/lib/git/providers";
import { isBranchName, isRepoName } from "@/lib/git/types";

type Context = { params: Promise<{ id: string }> };

interface PatchBody {
  name?: string;
  addBranches?: unknown;
  removeBranchIds?: unknown;
}

/**
 * Rename the agent-facing name, track more branches (each must exist on the
 * provider) or stop tracking some. The default branch stays: it is what the agent
 * falls back to.
 */
export async function PATCH(request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const repo = await getRepository(ctx.orgId, id);
  if (!repo) return gitNotFound();
  const body = await jsonBody<PatchBody>(request);
  if (body instanceof Response) return body;

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!isRepoName(name)) return unprocessable("Use letters, digits, . _ - and at most one /", "name");
    try {
      await renameRepository(ctx.orgId, id, name);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return Response.json({ error: `Another repository is already called "${name}"`, field: "name" }, { status: 409 });
      }
      throw err;
    }
  }

  let added: string[] = [];
  if (body.addBranches !== undefined) {
    const wanted = Array.isArray(body.addBranches) ? [...new Set(body.addBranches)] : [];
    if (!wanted.length || !wanted.every(isBranchName)) return unprocessable("Invalid branch name", "addBranches");
    const connection = await getConnectionSecrets(ctx.orgId, repo.connectionId);
    if (!connection) return gitNotFound();
    try {
      const provider = PROVIDERS[connection.provider];
      // A typo would otherwise surface minutes later as a failed fetch.
      const existing = await Promise.all((wanted as string[]).map((b) => provider.hasBranch(connection, repo.fullName, b)));
      const missing = (wanted as string[]).filter((_, i) => !existing[i]);
      if (missing.length) return unprocessable(`No such branch on ${repo.fullName}: ${missing.join(", ")}`, "addBranches");
    } catch (err) {
      return Response.json({ error: errorText(err) }, { status: 502 });
    }
    added = await addBranches(id, wanted as string[]);
  }

  let removed = 0;
  if (body.removeBranchIds !== undefined) {
    const ids = Array.isArray(body.removeBranchIds) ? body.removeBranchIds.filter((x): x is string => typeof x === "string") : [];
    removed = await removeBranches(id, repo.defaultBranch, ids);
  }

  // A rename too: the agent addresses repos by name, and the prompt advertises the new one at once.
  if (added.length || removed || body.name !== undefined) pushManifestSoon(ctx.orgId);
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "git.repository.updated",
    metadata: { repositoryId: id, name: body.name?.trim(), addedBranches: added, removedBranches: removed },
  });
  return Response.json({ ok: true, addedBranches: added, removedBranches: removed });
}

/** Stop syncing a repository. The gateway deletes its clone and indexes on the next manifest push. */
export async function DELETE(_request: Request, context: Context) {
  const ctx = await gitApiContext();
  if (ctx instanceof Response) return ctx;
  const { id } = await context.params;
  const row = await deleteRepository(ctx.orgId, id);
  if (!row) return gitNotFound();
  pushManifestSoon(ctx.orgId);
  await writeAudit({
    actorId: ctx.userId,
    orgId: ctx.orgId,
    action: "git.repository.removed",
    metadata: { repositoryId: id, name: row.name },
  });
  return Response.json({ ok: true });
}
