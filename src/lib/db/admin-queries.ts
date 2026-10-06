import "server-only";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "./index";
import {
  auditLog,
  conversations,
  holmesAgents,
  messages,
  orgMemberships,
  organizations,
  users,
} from "./schema";

// ---- Time ranges ----

export interface DateRange {
  from: Date;
  to: Date;
}

export type RangePreset = "today" | "7d" | "30d" | "90d" | "all";
export const RANGE_PRESETS: RangePreset[] = ["today", "7d", "30d", "90d", "all"];

/** Resolve a range query into concrete from/to dates. Defaults to 30d. */
export function resolveRange(opts: {
  range?: string | null;
  from?: string | null;
  to?: string | null;
}): { range: string; from: Date; to: Date } {
  const now = new Date();
  const to = opts.to ? new Date(opts.to) : now;

  if (opts.range === "custom" && opts.from) {
    return { range: "custom", from: new Date(opts.from), to };
  }

  const preset = (RANGE_PRESETS as string[]).includes(opts.range ?? "")
    ? (opts.range as RangePreset)
    : "30d";

  if (preset === "all") return { range: "all", from: new Date(0), to };
  if (preset === "today") {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { range: "today", from, to };
  }
  const days = preset === "7d" ? 7 : preset === "90d" ? 90 : 30;
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { range: preset, from, to };
}

/**
 * Whose investigations an analytics query counts. The console's org sections
 * pass `orgId` (an org admin sees their org only); the platform user page passes
 * `userId`; nothing means every org, which only platform-admin routes may ask.
 */
export interface AnalyticsFilter {
  orgId?: string;
  userId?: string;
}

/**
 * WHERE clause for completed investigations (assistant messages) in a range.
 * Every query using it joins `conversations`, which is where org and user live.
 */
function investigationsInRange(range: DateRange, filter: AnalyticsFilter = {}) {
  const clauses = [
    eq(messages.role, "assistant"),
    gte(messages.createdAt, range.from),
    lte(messages.createdAt, range.to),
  ];
  if (filter.orgId) clauses.push(eq(conversations.orgId, filter.orgId));
  if (filter.userId) clauses.push(eq(conversations.userId, filter.userId));
  return and(...clauses);
}

const withConversation = eq(messages.conversationId, conversations.id);

// Reusable SQL fragments (casts force real JS numbers — postgres-js returns
// bigint/numeric as strings otherwise).
const SPEND = sql<number>`coalesce(sum(${messages.costUsd}), 0)::float`;
const TOKENS = sql<number>`coalesce(sum(${messages.totalTokens}), 0)::float`;
const COUNT = sql<number>`count(*)::int`;
// jsonb::text output puts a space after ':' — a cheap error signal without a
// full jsonb walk over every tool_calls entry.
const ERRORED = sql<number>`count(*) filter (where ${messages.rawResponse}::text ilike '%"status": "error"%')::int`;

// ---- Overview ----

export interface OverviewKpis {
  spend: number;
  investigations: number;
  tokens: number;
  avgDurationMs: number;
  erroredInvestigations: number;
  activeUsers: number;
  totalUsers: number;
}

export async function overviewKpis(
  range: DateRange,
  filter: AnalyticsFilter = {},
): Promise<OverviewKpis> {
  const [agg] = await db
    .select({
      spend: SPEND,
      tokens: TOKENS,
      investigations: COUNT,
      errored: ERRORED,
      avgDurationMs: sql<number>`coalesce(avg(${messages.durationMs}), 0)::float`,
    })
    .from(messages)
    .innerJoin(conversations, withConversation)
    .where(investigationsInRange(range, filter));

  const [au] = await db
    .select({
      activeUsers: sql<number>`count(distinct ${conversations.userId})::int`,
    })
    .from(messages)
    .innerJoin(conversations, withConversation)
    .where(investigationsInRange(range, filter));

  // An org's "users" are its members; the platform's are every account.
  const [tu] = filter.orgId
    ? await db
        .select({ totalUsers: sql<number>`count(*)::int` })
        .from(orgMemberships)
        .where(eq(orgMemberships.orgId, filter.orgId))
    : await db.select({ totalUsers: sql<number>`count(*)::int` }).from(users);

  return {
    spend: agg?.spend ?? 0,
    tokens: agg?.tokens ?? 0,
    investigations: agg?.investigations ?? 0,
    erroredInvestigations: agg?.errored ?? 0,
    avgDurationMs: agg?.avgDurationMs ?? 0,
    activeUsers: au?.activeUsers ?? 0,
    totalUsers: tu?.totalUsers ?? 0,
  };
}

// ---- Time series ----

export interface SpendPoint {
  day: string;
  spend: number;
  investigations: number;
}

export async function spendOverTime(
  range: DateRange,
  filter: AnalyticsFilter = {},
): Promise<SpendPoint[]> {
  const bucket = sql`date_trunc('day', ${messages.createdAt})`;
  return db
    .select({
      day: sql<string>`to_char(${bucket}, 'YYYY-MM-DD')`,
      spend: SPEND,
      investigations: COUNT,
    })
    .from(messages)
    .innerJoin(conversations, withConversation)
    .where(investigationsInRange(range, filter))
    .groupBy(bucket)
    .orderBy(bucket);
}

// ---- Breakdowns ----

export interface ModelUsage {
  model: string;
  spend: number;
  investigations: number;
  tokens: number;
}

export async function costByModel(
  range: DateRange,
  filter: AnalyticsFilter = {},
): Promise<ModelUsage[]> {
  const rows = await db
    .select({
      model: messages.model,
      spend: SPEND,
      investigations: COUNT,
      tokens: TOKENS,
    })
    .from(messages)
    .innerJoin(conversations, withConversation)
    .where(investigationsInRange(range, filter))
    .groupBy(messages.model)
    .orderBy(desc(SPEND));
  return rows.map((r) => ({ ...r, model: r.model ?? "unknown" }));
}

export interface UserCost {
  userId: string;
  username: string;
  spend: number;
  investigations: number;
  tokens: number;
}

export async function costByUser(
  range: DateRange,
  limit = 50,
  filter: AnalyticsFilter = {},
): Promise<UserCost[]> {
  return db
    .select({
      userId: users.id,
      username: users.username,
      spend: SPEND,
      investigations: COUNT,
      tokens: TOKENS,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(users, eq(conversations.userId, users.id))
    .where(investigationsInRange(range, filter))
    .groupBy(users.id, users.username)
    .orderBy(desc(SPEND))
    .limit(limit);
}

// ---- Users list (includes zero-activity users) ----

export interface UserStats {
  id: string;
  username: string;
  role: "user" | "admin";
  createdAt: Date;
  spend: number;
  investigations: number;
  tokens: number;
  activeConversations: number;
  lastActive: Date | null;
}

export async function listUsersWithStats(range: DateRange): Promise<UserStats[]> {
  const stats = db
    .select({
      userId: conversations.userId,
      spend: sql<number>`coalesce(sum(${messages.costUsd}), 0)::float`.as("spend"),
      tokens:
        sql<number>`coalesce(sum(${messages.totalTokens}), 0)::float`.as("tokens"),
      investigations: sql<number>`count(*)::int`.as("investigations"),
      activeConversations:
        sql<number>`count(distinct ${conversations.id})::int`.as(
          "active_conversations",
        ),
      lastActive: sql<Date>`max(${messages.createdAt})`.as("last_active"),
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(investigationsInRange(range))
    .groupBy(conversations.userId)
    .as("stats");

  return db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
      spend: sql<number>`coalesce(${stats.spend}, 0)`,
      tokens: sql<number>`coalesce(${stats.tokens}, 0)`,
      investigations: sql<number>`coalesce(${stats.investigations}, 0)`,
      activeConversations: sql<number>`coalesce(${stats.activeConversations}, 0)`,
      lastActive: stats.lastActive,
    })
    .from(users)
    .leftJoin(stats, eq(stats.userId, users.id))
    .orderBy(desc(sql`coalesce(${stats.spend}, 0)`), users.username);
}

// ---- Organizations (platform view) ----

export interface OrgStats {
  id: string;
  name: string;
  createdAt: Date;
  members: number;
  agents: number;
  clusters: number;
  spend: number;
  investigations: number;
  lastActive: Date | null;
}

/**
 * Every org with its size and its chat spend in the range — the platform
 * operator's cross-tenant view. Correlated counts are plain SQL for the reason
 * given on `listClusters` (drizzle interpolates unqualified identifiers).
 */
export async function listOrgsWithStats(range: DateRange): Promise<OrgStats[]> {
  const usage = db
    .select({
      orgId: conversations.orgId,
      spend: sql<number>`coalesce(sum(${messages.costUsd}), 0)::float`.as("spend"),
      investigations: sql<number>`count(*)::int`.as("investigations"),
      lastActive: sql<Date>`max(${messages.createdAt})`.as("last_active"),
    })
    .from(messages)
    .innerJoin(conversations, withConversation)
    .where(investigationsInRange(range))
    .groupBy(conversations.orgId)
    .as("usage");

  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      createdAt: organizations.createdAt,
      members: sql<number>`(select count(*)::int from org_memberships m where m.org_id = organizations.id)`,
      agents: sql<number>`(select count(*)::int from holmes_agents a where a.org_id = organizations.id)`,
      clusters: sql<number>`(select count(*)::int from monitoring_clusters c where c.org_id = organizations.id)`,
      spend: sql<number>`coalesce(${usage.spend}, 0)`,
      investigations: sql<number>`coalesce(${usage.investigations}, 0)`,
      lastActive: usage.lastActive,
    })
    .from(organizations)
    .leftJoin(usage, eq(usage.orgId, organizations.id))
    .orderBy(desc(sql`coalesce(${usage.spend}, 0)`), organizations.name);
}

// ---- Per-user detail ----

export interface UserDetail {
  user: { id: string; username: string; role: "user" | "admin"; createdAt: Date };
  totals: { spend: number; investigations: number; tokens: number };
  spendOverTime: SpendPoint[];
  agents: {
    id: string;
    name: string;
    url: string;
    lastValidatedAt: Date | null;
    createdAt: Date;
  }[];
  conversations: {
    id: string;
    title: string;
    model: string;
    status: string;
    updatedAt: Date;
  }[];
}

export async function userDetail(
  userId: string,
  range: DateRange,
): Promise<UserDetail | null> {
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) return null;

  const [totals] = await db
    .select({ spend: SPEND, investigations: COUNT, tokens: TOKENS })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .where(investigationsInRange(range, { userId }));

  const series = await spendOverTime(range, { userId });

  const agents = await db
    .select({
      id: holmesAgents.id,
      name: holmesAgents.name,
      url: holmesAgents.url,
      lastValidatedAt: holmesAgents.lastValidatedAt,
      createdAt: holmesAgents.createdAt,
    })
    .from(holmesAgents)
    // Agents are org-owned now; a user's page lists the ones they registered.
    .where(eq(holmesAgents.createdBy, userId))
    .orderBy(holmesAgents.createdAt);

  const convos = await db
    .select({
      id: conversations.id,
      title: conversations.title,
      model: conversations.model,
      status: conversations.status,
      updatedAt: conversations.updatedAt,
    })
    .from(conversations)
    .where(eq(conversations.userId, userId))
    .orderBy(desc(conversations.updatedAt))
    .limit(25);

  return {
    user,
    totals: {
      spend: totals?.spend ?? 0,
      investigations: totals?.investigations ?? 0,
      tokens: totals?.tokens ?? 0,
    },
    spendOverTime: series,
    agents,
    conversations: convos,
  };
}

// ---- Global activity feed ----

export interface InvestigationRow {
  messageId: string;
  conversationId: string;
  title: string;
  userId: string;
  username: string;
  model: string | null;
  costUsd: number | null;
  durationMs: number | null;
  totalTokens: number | null;
  status: string;
  toolCalls: number;
  errored: boolean;
  createdAt: Date;
}

export async function recentInvestigations(opts: {
  range: DateRange;
  filter: AnalyticsFilter;
  model?: string;
  limit?: number;
}): Promise<InvestigationRow[]> {
  const clauses = [investigationsInRange(opts.range, opts.filter)];
  if (opts.model) clauses.push(eq(messages.model, opts.model));

  return db
    .select({
      messageId: messages.id,
      conversationId: conversations.id,
      title: conversations.title,
      userId: users.id,
      username: users.username,
      model: messages.model,
      costUsd: messages.costUsd,
      durationMs: messages.durationMs,
      totalTokens: messages.totalTokens,
      status: conversations.status,
      toolCalls: sql<number>`coalesce(jsonb_array_length(${messages.rawResponse} -> 'tool_calls'), 0)::int`,
      errored: sql<boolean>`(${messages.rawResponse}::text ilike '%"status": "error"%')`,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .innerJoin(conversations, eq(messages.conversationId, conversations.id))
    .innerJoin(users, eq(conversations.userId, users.id))
    .where(and(...clauses))
    .orderBy(desc(messages.createdAt))
    .limit(opts.limit ?? 100);
}

// ---- Agent (endpoint) health ----

export interface AgentHealthRow {
  id: string;
  name: string;
  url: string;
  /** Who registered it; null once that user is deleted (the agent stays the org's). */
  addedByUsername: string | null;
  lastValidatedAt: Date | null;
  createdAt: Date;
  conversationCount: number;
}

/** Agent health for one org — the console's view of the agents its members use. */
export async function listAgentHealth(orgId: string): Promise<AgentHealthRow[]> {
  const convCount = db
    .select({
      agentId: conversations.agentId,
      n: sql<number>`count(*)::int`.as("n"),
    })
    .from(conversations)
    .groupBy(conversations.agentId)
    .as("conv_count");

  // apiKey is deliberately never selected.
  return db
    .select({
      id: holmesAgents.id,
      name: holmesAgents.name,
      url: holmesAgents.url,
      addedByUsername: users.username,
      lastValidatedAt: holmesAgents.lastValidatedAt,
      createdAt: holmesAgents.createdAt,
      conversationCount: sql<number>`coalesce(${convCount.n}, 0)`,
    })
    .from(holmesAgents)
    .leftJoin(users, eq(holmesAgents.createdBy, users.id))
    .leftJoin(convCount, eq(convCount.agentId, holmesAgents.id))
    .where(eq(holmesAgents.orgId, orgId))
    .orderBy(holmesAgents.lastValidatedAt);
}

// ---- Audit log ----

export async function writeAudit(opts: {
  actorId: string;
  /** The org the action happened in; omit for platform-level actions. */
  orgId?: string | null;
  action: string;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLog).values({
    actorId: opts.actorId,
    orgId: opts.orgId ?? null,
    action: opts.action,
    targetUserId: opts.targetUserId ?? null,
    metadata: opts.metadata ?? null,
  });
}

export interface AuditRow {
  id: string;
  orgName: string | null;
  action: string;
  actorId: string;
  actorUsername: string | null;
  targetUserId: string | null;
  targetUsername: string | null;
  metadata: unknown;
  createdAt: Date;
}

/** One org's audit trail (`orgId`), or every org's when it is omitted (platform). */
export async function listAudit(
  range: DateRange,
  opts: { orgId?: string; limit?: number } = {},
): Promise<AuditRow[]> {
  const actor = alias(users, "audit_actor");
  const target = alias(users, "audit_target");
  return db
    .select({
      id: auditLog.id,
      orgName: organizations.name,
      action: auditLog.action,
      actorId: auditLog.actorId,
      actorUsername: actor.username,
      targetUserId: auditLog.targetUserId,
      targetUsername: target.username,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(actor, eq(auditLog.actorId, actor.id))
    .leftJoin(target, eq(auditLog.targetUserId, target.id))
    .leftJoin(organizations, eq(organizations.id, auditLog.orgId))
    .where(
      and(
        gte(auditLog.createdAt, range.from),
        lte(auditLog.createdAt, range.to),
        opts.orgId ? eq(auditLog.orgId, opts.orgId) : undefined,
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(opts.limit ?? 200);
}
