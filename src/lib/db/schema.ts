import {
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { ArtifactGraph } from "@/lib/artifacts/types";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const holmesAgents = pgTable("holmes_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  // Stored as plaintext: Drill must replay it verbatim to Holmes on every
  // request. Accepted tradeoff for an internal tool (docs/DECISIONS.md).
  apiKey: text("api_key").notNull(),
  lastValidatedAt: timestamp("last_validated_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id")
    .notNull()
    .references(() => holmesAgents.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  model: text("model").notNull(),
  status: text("status", { enum: ["open", "resolved"] })
    .notNull()
    .default("open"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  /** User ask, or the assistant `analysis` markdown. */
  content: text("content").notNull(),
  /**
   * Full raw Holmes response (assistant only) — kept for multi-turn
   * conversation_history replay and re-rendering the tool timeline.
   */
  rawResponse: jsonb("raw_response"),
  model: text("model"),
  costUsd: real("cost_usd"),
  totalTokens: integer("total_tokens"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Distilled knowledge from resolved investigations. Global: readable and
 * editable by every user (conversations stay private); only the resolver
 * may delete. A conversation has at most one artifact — re-resolving
 * upserts on conversation_id.
 *
 * The migration also adds a `search_vector` tsvector generated column +
 * GIN/pg_trgm indexes; it is intentionally not modeled here (drizzle-kit
 * cannot express generated tsvector columns — SQL in drizzle/ is the truth).
 */
export const resolutionArtifacts = pgTable("resolution_artifacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  // set null (not cascade): knowledge must survive conversation deletion.
  conversationId: uuid("conversation_id")
    .unique()
    .references(() => conversations.id, { onDelete: "set null" }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  lastEditedBy: uuid("last_edited_by").references(() => users.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  rootCause: text("root_cause").notNull(),
  symptoms: text("symptoms").array().notNull(),
  affectedServices: text("affected_services").array().notNull(),
  tags: text("tags").array().notNull(),
  resolutionSteps: jsonb("resolution_steps").$type<string[]>().notNull(),
  verificationSteps: jsonb("verification_steps").$type<string[]>().notNull(),
  graph: jsonb("graph").$type<ArtifactGraph>().notNull(),
  // pgvector-ready: unused until an embedding provider is configured.
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
