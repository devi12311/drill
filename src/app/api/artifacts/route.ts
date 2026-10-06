import { getAuthContext, unauthorized } from "@/lib/auth/session";
import { getConversation, upsertArtifact } from "@/lib/db/queries";
import { searchArtifacts } from "@/lib/artifacts/search";
import { validateDraft } from "@/lib/artifacts/types";

/** Search/browse the org's knowledge base. Empty q = newest first. */
export async function GET(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  const url = new URL(request.url);
  try {
    const hits = await searchArtifacts(url.searchParams.get("q") ?? "", {
      orgId: ctx.orgId,
      service: url.searchParams.get("service") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
      limit: 50,
    });
    return Response.json(hits);
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}

/**
 * Save a reviewed draft for one of the caller's conversations. Upserts on
 * conversation_id (re-resolve replaces) and marks the conversation resolved.
 */
export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  let body: { conversation_id?: unknown } & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const conversationId = body.conversation_id;
  if (typeof conversationId !== "string") {
    return Response.json(
      { error: "conversation_id is required" },
      { status: 400 },
    );
  }
  let draft;
  try {
    draft = validateDraft(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid artifact";
    return Response.json({ error: message }, { status: 400 });
  }
  try {
    const conversation = await getConversation(ctx, conversationId);
    if (!conversation) {
      return Response.json(
        { error: "Conversation not found" },
        { status: 404 },
      );
    }
    const artifact = await upsertArtifact(ctx, conversationId, draft);
    return Response.json(artifact, { status: 201 });
  } catch {
    return Response.json({ error: "Database unreachable" }, { status: 503 });
  }
}
