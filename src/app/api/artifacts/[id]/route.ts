import { getAuthUser, unauthorized } from "@/lib/auth/session";
import { deleteArtifact, getArtifact, updateArtifact } from "@/lib/db/queries";
import { validateDraft } from "@/lib/artifacts/types";

type Context = { params: Promise<{ id: string }> };

/** Artifacts are global knowledge — readable by any authed user. */
export async function GET(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    const artifact = await getArtifact(id);
    if (!artifact) {
      return Response.json({ error: "Artifact not found" }, { status: 404 });
    }
    return Response.json(artifact);
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

/** Any authed user may correct/extend an artifact; edits are attributed. */
export async function PATCH(request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  let draft;
  try {
    draft = validateDraft(await request.json());
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid artifact";
    return Response.json({ error: message }, { status: 400 });
  }
  try {
    const artifact = await updateArtifact(id, user.id, draft);
    if (!artifact) {
      return Response.json({ error: "Artifact not found" }, { status: 404 });
    }
    return Response.json(artifact);
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

/**
 * Unresolve: resolver-only (403 otherwise — artifacts are app-public, so
 * no 404 masking). Flips the linked conversation back to open.
 */
export async function DELETE(_request: Request, context: Context) {
  const user = await getAuthUser();
  if (!user) return unauthorized();
  const { id } = await context.params;
  try {
    const result = await deleteArtifact(id, user.id);
    if (result === "not_found") {
      return Response.json({ error: "Artifact not found" }, { status: 404 });
    }
    if (result === "forbidden") {
      return Response.json(
        { error: "Only the resolver can delete this artifact" },
        { status: 403 },
      );
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
