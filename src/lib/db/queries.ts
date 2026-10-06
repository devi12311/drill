import "server-only";
import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, type DbExecutor } from "./index";
import { openSecret, sealSecret } from "@/lib/secrets";
import { isUuid } from "@/lib/uuid";
import {
  chatTurns,
  conversations,
  holmesAgents,
  messages,
  resolutionArtifacts,
  users,
} from "./schema";
import type { ConversationActivity } from "@/lib/chat/types";
import type {
  ConversationMessage,
  HolmesChatResponse,
} from "@/lib/holmes/types";
import type { ArtifactDraft } from "@/lib/artifacts/types";
import type { MessageSkill } from "@/lib/skills/types";

// ---- Users ----

/** Existence check for session validation (JWTs can outlive user rows). */
export async function userExists(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId));
  return !!row;
}

/** Identity + current role for a user (DB is the source of truth for role). */
export async function getUserById(userId: string) {
  const [row] = await db
    .select({ id: users.id, username: users.username, role: users.role })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}

// ---- Scope ----

/**
 * The tenant and member a query runs for. Every org-owned read and write takes
 * one, so the org boundary is enforced here rather than remembered per route.
 * Built from the request's AuthContext, or from a queued turn in the worker.
 */
export interface Scope {
  orgId: string;
  userId: string;
}

/** A Scope that may also manage the org's shared things. */
export interface ManagerScope extends Scope {
  isOrgAdmin: boolean;
}

// ---- Agents (org-owned) ----

const agentColumns = {
  id: holmesAgents.id,
  name: holmesAgents.name,
  url: holmesAgents.url,
  createdBy: holmesAgents.createdBy,
  lastValidatedAt: holmesAgents.lastValidatedAt,
  lastError: holmesAgents.lastError,
  createdAt: holmesAgents.createdAt,
};

export async function listAgents(orgId: string) {
  return db
    .select(agentColumns)
    .from(holmesAgents)
    .where(eq(holmesAgents.orgId, orgId))
    .orderBy(holmesAgents.createdAt);
}

/**
 * Full agent row with the apiKey OPENED — server-side use only, never serialized.
 * The one read path for the credential, so it is decrypted here and nowhere else.
 */
export async function getAgent(orgId: string, agentId: string) {
  if (!isUuid(agentId)) return null;
  const [agent] = await db
    .select()
    .from(holmesAgents)
    .where(and(eq(holmesAgents.id, agentId), eq(holmesAgents.orgId, orgId)));
  return agent ? { ...agent, apiKey: openSecret(agent.apiKey) } : null;
}

export async function createAgent(
  scope: Scope,
  data: { name: string; url: string; apiKey: string },
) {
  const [agent] = await db
    .insert(holmesAgents)
    .values({
      ...data,
      apiKey: sealSecret(data.apiKey),
      orgId: scope.orgId,
      createdBy: scope.userId,
      lastValidatedAt: new Date(),
      lastError: null,
    })
    .returning(agentColumns);
  return agent;
}

/** Org admins only — the routes check; a member could otherwise redirect everyone's investigations. */
const orgAgent = (orgId: string, agentId: string) =>
  and(eq(holmesAgents.id, agentId), eq(holmesAgents.orgId, orgId));

export async function updateAgent(
  orgId: string,
  agentId: string,
  data: Partial<{ name: string; url: string; apiKey: string }>,
) {
  const [agent] = await db
    .update(holmesAgents)
    .set({
      ...data,
      ...(data.apiKey !== undefined && { apiKey: sealSecret(data.apiKey) }),
      // Callers validate before saving, so a save is a successful contact.
      lastValidatedAt: new Date(),
      lastError: null,
    })
    .where(orgAgent(orgId, agentId))
    .returning(agentColumns);
  return agent ?? null;
}

export async function deleteAgent(orgId: string, agentId: string) {
  const deleted = await db
    .delete(holmesAgents)
    .where(orgAgent(orgId, agentId))
    .returning({ id: holmesAgents.id });
  return deleted.length > 0;
}

/** Every agent of every org, key opened — for the worker's health probe only. */
export async function listAgentsToProbe() {
  const rows = await db
    .select({ id: holmesAgents.id, url: holmesAgents.url, apiKey: holmesAgents.apiKey })
    .from(holmesAgents);
  return rows.map((r) => ({ ...r, apiKey: openSecret(r.apiKey) }));
}

/** Stamp one contact with an agent: success refreshes it, a failure says why. */
export async function recordAgentContact(agentId: string, error: string | null) {
  await db
    .update(holmesAgents)
    .set(
      error
        ? { lastError: error.slice(0, 2000) }
        : { lastValidatedAt: new Date(), lastError: null },
    )
    .where(eq(holmesAgents.id, agentId));
}

// ---- Conversations (private to their user, inside the org) ----

const ownConversation = (scope: Scope, conversationId: string) =>
  and(
    eq(conversations.id, conversationId),
    eq(conversations.userId, scope.userId),
    eq(conversations.orgId, scope.orgId),
  );

/** True when a stored raw response is a pause awaiting tool approval. */
function isPaused(raw: SQL | typeof messages.rawResponse): SQL<boolean> {
  return sql<boolean>`(jsonb_typeof(${raw}->'pending_approvals') = 'array'
    and jsonb_array_length(${raw}->'pending_approvals') > 0)`;
}

/**
 * The sidebar list. `activity` is what the row's dot shows: the open turn's
 * status, else whether the latest answer is a pause still waiting on the user.
 */
export async function listConversations(
  scope: Scope,
  agentId: string,
): Promise<
  {
    id: string;
    title: string;
    model: string;
    status: "open" | "resolved";
    artifactId: string | null;
    updatedAt: Date;
    activity: ConversationActivity;
  }[]
> {
  const latestRaw = sql`(select m.raw_response from ${messages} m
    where m.conversation_id = ${conversations.id} and m.role = 'assistant'
    order by m.created_at desc limit 1)`;
  const rows = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      model: conversations.model,
      status: conversations.status,
      artifactId: resolutionArtifacts.id,
      updatedAt: conversations.updatedAt,
      turnStatus: chatTurns.status,
      awaitingApproval: sql<boolean>`coalesce(${isPaused(latestRaw)}, false)`,
    })
    .from(conversations)
    .leftJoin(
      resolutionArtifacts,
      eq(resolutionArtifacts.conversationId, conversations.id),
    )
    .leftJoin(chatTurns, eq(chatTurns.conversationId, conversations.id))
    .where(
      and(
        eq(conversations.userId, scope.userId),
        eq(conversations.orgId, scope.orgId),
        eq(conversations.agentId, agentId),
      ),
    )
    .orderBy(desc(conversations.updatedAt));
  return rows.map(({ turnStatus, awaitingApproval, ...row }) => ({
    ...row,
    activity: turnStatus ?? (awaitingApproval ? "awaiting_approval" : null),
  }));
}

export async function createConversation(
  scope: Scope,
  opts: { agentId: string; ask: string; model: string },
) {
  const title = opts.ask.replace(/\s+/g, " ").trim().slice(0, 80);
  const [row] = await db
    .insert(conversations)
    .values({
      orgId: scope.orgId,
      userId: scope.userId,
      agentId: opts.agentId,
      title,
      model: opts.model,
    })
    .returning();
  return row;
}

/** Conversation row if owned by the user in this org, else null. */
export async function getConversation(scope: Scope, conversationId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(ownConversation(scope, conversationId));
  return row ?? null;
}

export async function getConversationMessages(
  scope: Scope,
  conversationId: string,
) {
  const conv = await getConversation(scope, conversationId);
  if (!conv) return null;
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

/**
 * The Holmes history to replay for a follow-up: the conversation_history
 * stored with this conversation's most recent assistant message.
 */
export async function getReplayHistory(
  conversationId: string,
): Promise<ConversationMessage[] | undefined> {
  const rows = await db
    .select({ raw: messages.rawResponse })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt));
  for (const row of rows) {
    const history = (row.raw as HolmesChatResponse | null)
      ?.conversation_history;
    if (history?.length) return history;
  }
  return undefined;
}

/**
 * What an interrupted turn resumes from (lib/chat/resume.ts): the last COMPLETE
 * history — skipping paused ones, which end in a tool call still awaiting its
 * result, after which a new user turn is invalid — plus the tool calls those
 * skipped pauses had already made, so their evidence is not lost with them.
 *
 * Reads flags first and fetches only the two payloads it needs: a stored raw
 * response can be hundreds of kilobytes.
 */
export async function resumeContext(conversationId: string): Promise<{
  history: ConversationMessage[] | undefined;
  priorToolCalls: HolmesChatResponse["tool_calls"];
}> {
  const rows = await db
    .select({
      id: messages.id,
      paused: isPaused(messages.rawResponse),
      hasHistory: sql<boolean>`jsonb_typeof(${messages.rawResponse}->'conversation_history') = 'array'
        and jsonb_array_length(${messages.rawResponse}->'conversation_history') > 0`,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "assistant"),
      ),
    )
    .orderBy(desc(messages.createdAt));

  const pausedIds: string[] = [];
  let anchorId: string | null = null;
  for (const row of rows) {
    if (row.paused) pausedIds.push(row.id);
    else if (row.hasHistory) {
      anchorId = row.id;
      break;
    }
  }
  const payload = async (id: string) => {
    const [row] = await db
      .select({ raw: messages.rawResponse })
      .from(messages)
      .where(eq(messages.id, id));
    return row?.raw as HolmesChatResponse | undefined;
  };
  const history = anchorId
    ? (await payload(anchorId))?.conversation_history
    : undefined;
  // Oldest pause first, so the evidence reads in the order it was gathered.
  const priorToolCalls: HolmesChatResponse["tool_calls"] = [];
  for (const id of pausedIds.reverse()) {
    priorToolCalls.push(...((await payload(id))?.tool_calls ?? []));
  }
  return { history, priorToolCalls };
}

/**
 * The paused Holmes state awaiting a tool approval, or null when the latest
 * assistant message is not a pause (answered, errored, or already decided).
 */
export async function getPendingApproval(
  conversationId: string,
): Promise<HolmesChatResponse | null> {
  const [row] = await db
    .select({ raw: messages.rawResponse })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.role, "assistant"),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  const raw = row?.raw as HolmesChatResponse | null | undefined;
  return raw?.pending_approvals?.length && raw.conversation_history?.length
    ? raw
    : null;
}

export async function addUserMessage(
  conversationId: string,
  ask: string,
  tx: DbExecutor = db,
  skill: MessageSkill | null = null,
) {
  await tx
    .insert(messages)
    .values({ conversationId, role: "user", content: ask, skill });
}

export async function addAssistantMessage(
  opts: {
    conversationId: string;
    response: HolmesChatResponse;
    model: string;
    durationMs: number;
  },
  tx: DbExecutor = db,
) {
  const { conversationId, response, model, durationMs } = opts;
  await tx.insert(messages).values({
    conversationId,
    role: "assistant",
    content: response.analysis ?? "",
    rawResponse: response,
    model,
    costUsd: response.metadata?.costs?.total_cost ?? null,
    totalTokens: response.metadata?.usage?.total_tokens ?? null,
    durationMs,
  });
  await tx
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function deleteConversation(scope: Scope, conversationId: string) {
  const deleted = await db
    .delete(conversations)
    .where(ownConversation(scope, conversationId))
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

// ---- Resolution artifacts (org-wide read/edit; resolver-only delete) ----

/**
 * The conversation as plain turns (user asks + assistant analysis) for
 * artifact distillation. Caller must have verified ownership already.
 */
export async function getConversationTranscript(conversationId: string) {
  return db
    .select({ role: messages.role, content: messages.content })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt);
}

const artifactColumns = {
  id: resolutionArtifacts.id,
  conversationId: resolutionArtifacts.conversationId,
  createdBy: resolutionArtifacts.createdBy,
  lastEditedBy: resolutionArtifacts.lastEditedBy,
  title: resolutionArtifacts.title,
  summary: resolutionArtifacts.summary,
  rootCause: resolutionArtifacts.rootCause,
  symptoms: resolutionArtifacts.symptoms,
  affectedServices: resolutionArtifacts.affectedServices,
  tags: resolutionArtifacts.tags,
  resolutionSteps: resolutionArtifacts.resolutionSteps,
  verificationSteps: resolutionArtifacts.verificationSteps,
  graph: resolutionArtifacts.graph,
  createdAt: resolutionArtifacts.createdAt,
  updatedAt: resolutionArtifacts.updatedAt,
};

function draftValues(draft: ArtifactDraft) {
  return {
    title: draft.title,
    summary: draft.summary,
    rootCause: draft.root_cause,
    symptoms: draft.symptoms,
    affectedServices: draft.affected_services,
    tags: draft.tags,
    resolutionSteps: draft.resolution_steps,
    verificationSteps: draft.verification_steps,
    graph: draft.graph,
  };
}

/**
 * Save a resolution for a conversation and flip it to `resolved`.
 * Re-resolving upserts in place (unique conversation_id).
 */
export async function upsertArtifact(
  scope: Scope,
  conversationId: string,
  draft: ArtifactDraft,
) {
  const values = draftValues(draft);
  const [row] = await db
    .insert(resolutionArtifacts)
    .values({
      ...values,
      orgId: scope.orgId,
      conversationId,
      createdBy: scope.userId,
    })
    .onConflictDoUpdate({
      target: resolutionArtifacts.conversationId,
      set: { ...values, lastEditedBy: scope.userId, updatedAt: new Date() },
    })
    .returning(artifactColumns);
  await db
    .update(conversations)
    .set({ status: "resolved" })
    .where(eq(conversations.id, conversationId));
  return row;
}

const artifactCreator = alias(users, "artifact_creator");
const artifactEditor = alias(users, "artifact_editor");

const inOrg = (orgId: string, artifactId: string) =>
  and(
    eq(resolutionArtifacts.id, artifactId),
    eq(resolutionArtifacts.orgId, orgId),
  );

/** Full artifact with resolver/editor usernames, if it belongs to the org. */
export async function getArtifact(orgId: string, artifactId: string) {
  const [row] = await db
    .select({
      ...artifactColumns,
      createdByUsername: artifactCreator.username,
      lastEditedByUsername: artifactEditor.username,
    })
    .from(resolutionArtifacts)
    .leftJoin(artifactCreator, eq(resolutionArtifacts.createdBy, artifactCreator.id))
    .leftJoin(
      artifactEditor,
      eq(resolutionArtifacts.lastEditedBy, artifactEditor.id),
    )
    .where(inOrg(orgId, artifactId));
  return row ?? null;
}

/** Any member of the org may edit; records who touched it last. */
export async function updateArtifact(
  scope: Scope,
  artifactId: string,
  draft: ArtifactDraft,
) {
  const [row] = await db
    .update(resolutionArtifacts)
    .set({
      ...draftValues(draft),
      lastEditedBy: scope.userId,
      updatedAt: new Date(),
    })
    .where(inOrg(scope.orgId, artifactId))
    .returning(artifactColumns);
  return row ?? null;
}

/**
 * Resolver-only delete. Returns "deleted" | "forbidden" | "not_found";
 * the linked conversation (if any) flips back to `open`.
 */
export async function deleteArtifact(scope: Scope, artifactId: string) {
  const [existing] = await db
    .select({
      createdBy: resolutionArtifacts.createdBy,
      conversationId: resolutionArtifacts.conversationId,
    })
    .from(resolutionArtifacts)
    .where(inOrg(scope.orgId, artifactId));
  if (!existing) return "not_found" as const;
  if (existing.createdBy !== scope.userId) return "forbidden" as const;
  await db
    .delete(resolutionArtifacts)
    .where(eq(resolutionArtifacts.id, artifactId));
  if (existing.conversationId) {
    await db
      .update(conversations)
      .set({ status: "open" })
      .where(eq(conversations.id, existing.conversationId));
  }
  return "deleted" as const;
}

export interface ArtifactSearchRow {
  id: string;
  title: string;
  summary: string;
  root_cause: string;
  symptoms: string[];
  affected_services: string[];
  tags: string[];
  resolution_steps: string[];
  resolved_by: string | null;
  updated_at: string;
  score: number;
}

/**
 * Hybrid FTS (weighted tsvector, OR-friendly `tsQuery` built by the caller)
 * + pg_trgm fuzzy match over title/services/symptoms. Empty query = browse
 * (newest first). `score` is ts_rank_cd(normalized) + 0.5 * trigram similarity.
 */
export async function searchArtifactRows(opts: {
  orgId: string;
  tsQuery: string;
  rawQuery: string;
  service?: string;
  tag?: string;
  limit: number;
}): Promise<ArtifactSearchRow[]> {
  const { orgId, tsQuery, rawQuery, service, tag, limit } = opts;
  const trgmDoc = sql`(${resolutionArtifacts.title} || ' ' || f_arr2text(${resolutionArtifacts.affectedServices}) || ' ' || f_arr2text(${resolutionArtifacts.symptoms}))`;
  const tsq = sql`(websearch_to_tsquery('english', ${tsQuery}) || websearch_to_tsquery('simple', ${tsQuery}))`;
  const hasQuery = rawQuery.trim().length > 0;
  // word_similarity (not similarity): a short query like "traffic-sources"
  // must match its best word in the document, not the whole document.
  const score = hasQuery
    ? sql<number>`(ts_rank_cd("search_vector", ${tsq}, 32) + 0.5 * word_similarity(${rawQuery}, ${trgmDoc}))`
    : sql<number>`0`;

  const conditions = [eq(resolutionArtifacts.orgId, orgId)];
  if (hasQuery)
    conditions.push(
      sql`("search_vector" @@ ${tsq} OR word_similarity(${rawQuery}, ${trgmDoc}) > 0.3)`,
    );
  if (service)
    conditions.push(sql`${service} ILIKE ANY(${resolutionArtifacts.affectedServices})`);
  if (tag) conditions.push(sql`${tag} ILIKE ANY(${resolutionArtifacts.tags})`);

  return db
    .select({
      id: resolutionArtifacts.id,
      title: resolutionArtifacts.title,
      summary: resolutionArtifacts.summary,
      root_cause: resolutionArtifacts.rootCause,
      symptoms: resolutionArtifacts.symptoms,
      affected_services: resolutionArtifacts.affectedServices,
      tags: resolutionArtifacts.tags,
      resolution_steps: resolutionArtifacts.resolutionSteps,
      resolved_by: artifactCreator.username,
      updated_at: sql<string>`${resolutionArtifacts.updatedAt}`,
      score,
    })
    .from(resolutionArtifacts)
    .leftJoin(artifactCreator, eq(resolutionArtifacts.createdBy, artifactCreator.id))
    .where(and(...conditions))
    // Browse mode (no query) must not order by the constant score: a bare
    // `0 DESC` is read by Postgres as an ordinal column position.
    .orderBy(
      ...(hasQuery ? [desc(score)] : []),
      desc(resolutionArtifacts.updatedAt),
    )
    .limit(limit);
}
