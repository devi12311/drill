import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./index";
import {
  conversations,
  holmesAgents,
  messages,
  resolutionArtifacts,
  users,
} from "./schema";
import type {
  ConversationMessage,
  HolmesChatResponse,
} from "@/lib/holmes/types";
import type { ArtifactDraft } from "@/lib/artifacts/types";

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

// ---- Agents (all user-scoped) ----

export async function listAgents(userId: string) {
  return db
    .select({
      id: holmesAgents.id,
      name: holmesAgents.name,
      url: holmesAgents.url,
      lastValidatedAt: holmesAgents.lastValidatedAt,
      createdAt: holmesAgents.createdAt,
    })
    .from(holmesAgents)
    .where(eq(holmesAgents.userId, userId))
    .orderBy(holmesAgents.createdAt);
}

/** Full agent row (incl. apiKey) — server-side use only, never serialized. */
export async function getAgent(userId: string, agentId: string) {
  const [agent] = await db
    .select()
    .from(holmesAgents)
    .where(and(eq(holmesAgents.id, agentId), eq(holmesAgents.userId, userId)));
  return agent ?? null;
}

export async function createAgent(
  userId: string,
  data: { name: string; url: string; apiKey: string },
) {
  const [agent] = await db
    .insert(holmesAgents)
    .values({ ...data, userId, lastValidatedAt: new Date() })
    .returning({
      id: holmesAgents.id,
      name: holmesAgents.name,
      url: holmesAgents.url,
      lastValidatedAt: holmesAgents.lastValidatedAt,
      createdAt: holmesAgents.createdAt,
    });
  return agent;
}

export async function updateAgent(
  userId: string,
  agentId: string,
  data: Partial<{ name: string; url: string; apiKey: string }>,
) {
  const [agent] = await db
    .update(holmesAgents)
    .set({ ...data, lastValidatedAt: new Date() })
    .where(and(eq(holmesAgents.id, agentId), eq(holmesAgents.userId, userId)))
    .returning({
      id: holmesAgents.id,
      name: holmesAgents.name,
      url: holmesAgents.url,
      lastValidatedAt: holmesAgents.lastValidatedAt,
      createdAt: holmesAgents.createdAt,
    });
  return agent ?? null;
}

export async function deleteAgent(userId: string, agentId: string) {
  const deleted = await db
    .delete(holmesAgents)
    .where(and(eq(holmesAgents.id, agentId), eq(holmesAgents.userId, userId)))
    .returning({ id: holmesAgents.id });
  return deleted.length > 0;
}

// ---- Conversations (all user-scoped) ----

export async function listConversations(userId: string, agentId: string) {
  return db
    .select({
      id: conversations.id,
      title: conversations.title,
      model: conversations.model,
      status: conversations.status,
      artifactId: resolutionArtifacts.id,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .leftJoin(
      resolutionArtifacts,
      eq(resolutionArtifacts.conversationId, conversations.id),
    )
    .where(
      and(eq(conversations.userId, userId), eq(conversations.agentId, agentId)),
    )
    .orderBy(desc(conversations.updatedAt));
}

export async function createConversation(opts: {
  userId: string;
  agentId: string;
  ask: string;
  model: string;
}) {
  const title = opts.ask.replace(/\s+/g, " ").trim().slice(0, 80);
  const [row] = await db
    .insert(conversations)
    .values({
      userId: opts.userId,
      agentId: opts.agentId,
      title,
      model: opts.model,
    })
    .returning();
  return row;
}

/** Conversation row if owned by the user, else null. */
export async function getConversation(userId: string, conversationId: string) {
  const [row] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    );
  return row ?? null;
}

export async function getConversationMessages(
  userId: string,
  conversationId: string,
) {
  const conv = await getConversation(userId, conversationId);
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

export async function addUserMessage(conversationId: string, ask: string) {
  await db
    .insert(messages)
    .values({ conversationId, role: "user", content: ask });
}

export async function addAssistantMessage(opts: {
  conversationId: string;
  response: HolmesChatResponse;
  model: string;
  durationMs: number;
}) {
  const { conversationId, response, model, durationMs } = opts;
  await db.insert(messages).values({
    conversationId,
    role: "assistant",
    content: response.analysis ?? "",
    rawResponse: response,
    model,
    costUsd: response.metadata?.costs?.total_cost ?? null,
    totalTokens: response.metadata?.usage?.total_tokens ?? null,
    durationMs,
  });
  await db
    .update(conversations)
    .set({ updatedAt: new Date() })
    .where(eq(conversations.id, conversationId));
}

export async function deleteConversation(
  userId: string,
  conversationId: string,
) {
  const deleted = await db
    .delete(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.userId, userId)),
    )
    .returning({ id: conversations.id });
  return deleted.length > 0;
}

// ---- Resolution artifacts (global read/edit; resolver-only delete) ----

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
  userId: string,
  conversationId: string,
  draft: ArtifactDraft,
) {
  const values = draftValues(draft);
  const [row] = await db
    .insert(resolutionArtifacts)
    .values({ ...values, conversationId, createdBy: userId })
    .onConflictDoUpdate({
      target: resolutionArtifacts.conversationId,
      set: { ...values, lastEditedBy: userId, updatedAt: new Date() },
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

/** Full artifact with resolver/editor usernames. Global read. */
export async function getArtifact(artifactId: string) {
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
    .where(eq(resolutionArtifacts.id, artifactId));
  return row ?? null;
}

/** Any authed user may edit; records who touched it last. */
export async function updateArtifact(
  artifactId: string,
  userId: string,
  draft: ArtifactDraft,
) {
  const [row] = await db
    .update(resolutionArtifacts)
    .set({ ...draftValues(draft), lastEditedBy: userId, updatedAt: new Date() })
    .where(eq(resolutionArtifacts.id, artifactId))
    .returning(artifactColumns);
  return row ?? null;
}

/**
 * Resolver-only delete. Returns "deleted" | "forbidden" | "not_found";
 * the linked conversation (if any) flips back to `open`.
 */
export async function deleteArtifact(artifactId: string, userId: string) {
  const [existing] = await db
    .select({
      createdBy: resolutionArtifacts.createdBy,
      conversationId: resolutionArtifacts.conversationId,
    })
    .from(resolutionArtifacts)
    .where(eq(resolutionArtifacts.id, artifactId));
  if (!existing) return "not_found" as const;
  if (existing.createdBy !== userId) return "forbidden" as const;
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
  tsQuery: string;
  rawQuery: string;
  service?: string;
  tag?: string;
  limit: number;
}): Promise<ArtifactSearchRow[]> {
  const { tsQuery, rawQuery, service, tag, limit } = opts;
  const trgmDoc = sql`(${resolutionArtifacts.title} || ' ' || f_arr2text(${resolutionArtifacts.affectedServices}) || ' ' || f_arr2text(${resolutionArtifacts.symptoms}))`;
  const tsq = sql`(websearch_to_tsquery('english', ${tsQuery}) || websearch_to_tsquery('simple', ${tsQuery}))`;
  const hasQuery = rawQuery.trim().length > 0;
  // word_similarity (not similarity): a short query like "traffic-sources"
  // must match its best word in the document, not the whole document.
  const score = hasQuery
    ? sql<number>`(ts_rank_cd("search_vector", ${tsq}, 32) + 0.5 * word_similarity(${rawQuery}, ${trgmDoc}))`
    : sql<number>`0`;

  const conditions = [];
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
    .where(conditions.length ? and(...conditions) : undefined)
    // Browse mode (no query) must not order by the constant score: a bare
    // `0 DESC` is read by Postgres as an ordinal column position.
    .orderBy(
      ...(hasQuery ? [desc(score)] : []),
      desc(resolutionArtifacts.updatedAt),
    )
    .limit(limit);
}
