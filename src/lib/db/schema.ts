import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { ArtifactGraph } from "@/lib/artifacts/types";
import type {
  ExpectedObservations,
  ObservationSpec,
} from "@/lib/monitoring/playbook";
import { TARGET_KINDS } from "@/lib/monitoring/types";
import type {
  ConcernStatus,
  MonitorCategory,
  MonitorDepth,
  MonitorEvidence,
  ObservationSource,
  RunCoverage,
  RunStatus,
  RunTrigger,
  Severity,
  TargetKind,
  WorkloadKind,
  WorkloadTechnology,
} from "@/lib/monitoring/types";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Privilege level. DB is the source of truth; the ADMIN_USERNAMES env
  // allowlist promotes matching usernames to 'admin' at login/register
  // (docs/DECISIONS.md). Impersonation keys off this.
  role: text("role", { enum: ["user", "admin"] })
    .notNull()
    .default("user"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Append-only record of privileged admin actions — impersonation start/stop
 * and role changes. Kept for accountability now that admins can act as other
 * users. `actorId` is the real admin; `targetUserId` the affected user (if any).
 */
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  targetUserId: uuid("target_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  metadata: jsonb("metadata"),
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

/**
 * A Kubernetes cluster under monitoring. Carries TWO credentials for two
 * different jobs, because Holmes cannot be pointed at an arbitrary cluster:
 * its kubernetes toolset shells out to `kubectl` with its own pod's
 * ServiceAccount and takes no context argument (docs/DECISIONS.md).
 *
 *  - `kubeconfig` — used by DRILL only, to discover Deployments/StatefulSets.
 *  - `holmesUrl`/`holmesApiKey` — a Holmes deployment living IN this cluster,
 *    which does all the actual investigating.
 *
 * Both are stored plaintext: Drill must replay them verbatim. Same accepted
 * tradeoff as `holmesAgents.apiKey`.
 */
export const monitoringClusters = pgTable("monitoring_clusters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  kubeconfig: text("kubeconfig").notNull(),
  holmesUrl: text("holmes_url").notNull(),
  holmesApiKey: text("holmes_api_key").notNull(),
  // Clusters are shared infrastructure, so they outlive the admin who added them.
  createdBy: uuid("created_by").references(() => users.id, {
    onDelete: "set null",
  }),
  lastValidatedAt: timestamp("last_validated_at"),
  lastDiscoveredAt: timestamp("last_discovered_at"),
  /** Last discovery failure, surfaced in the UI; null once a run succeeds. */
  discoveryError: text("discovery_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * THE RUBRIC, as live data. Holds both the built-in checks (seeded from
 * `BUILTIN_CHECKS` in lib/monitoring/catalogue.ts, which stays the reviewed,
 * cited definition in git) and any custom checks an admin adds.
 *
 * The primary key IS the check ID, and it is immutable once created: concerns
 * reference it by value forever, so renaming one would orphan its history.
 * Deliberately NOT an FK from `monitoring_concerns.check_id` — a deleted check
 * must not cascade away the history it produced. Built-ins can be disabled but
 * never deleted; a custom check is deletable only while no concern references it.
 *
 * `version` is bumped when an edit changes what the check MEANS, and is stamped
 * onto every concern raised afterwards, so a rubric change is visible in history
 * instead of looking like a real-world regression.
 */
export const monitoringChecks = pgTable(
  "monitoring_checks",
  {
    /** e.g. "SEC.PRIVILEGED", "PERF.OOM_KILLS", "CUSTOM.MY_RULE". Immutable. */
    id: text("id").primaryKey(),
    category: text("category", { enum: ["security", "performance"] })
      .$type<MonitorCategory>()
      .notNull(),
    title: text("title").notNull(),
    /** The precise question Holmes must answer for one workload. */
    question: text("question").notNull(),
    /** What must be cited as evidence when the check fails. */
    evidence: text("evidence").notNull(),
    /** The standard or tool that codifies this check. */
    reference: text("reference").notNull().default(""),
    baseSeverity: text("base_severity", {
      enum: ["critical", "high", "medium", "low", "info"],
    })
      .$type<Severity>()
      .notNull(),
    /** Empty array = applies to every workload kind. */
    appliesTo: text("applies_to").array().notNull().default([]),
    /**
     * Empty array = technology-agnostic (the posture checks). Otherwise the check
     * only ever reaches a workload running one of these, so `PG.WAL_BLOATING`
     * never gets asked about a RabbitMQ pod.
     */
    appliesToTechnologies: text("applies_to_technologies")
      .array()
      .notNull()
      .default([]),
    /**
     * Technologies this check is suppressed for — either because the generic form
     * is a false positive there, or because a profile check asks it better and both
     * firing would open two concerns for one problem.
     */
    excludesTechnologies: text("excludes_technologies")
      .array()
      .notNull()
      .default([]),
    /** Telemetry the check depends on; absent ⇒ Holmes must skip, not pass. */
    requires: text("requires"),
    /** Consecutive evaluated-but-absent runs before the concern auto-resolves. */
    resolveAfterAbsentRuns: integer("resolve_after_absent_runs")
      .notNull()
      .default(1),
    /** Shipped with Drill: editable and disableable, but never deletable. */
    builtin: boolean("builtin").notNull().default(false),
    /** Disabled checks are excluded from prompts and stop being evaluated. */
    enabled: boolean("enabled").notNull().default(true),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("monitoring_checks_category_idx").on(t.category, t.enabled)],
);

/**
 * Per-job deviations from the catalogue: a check that is noise in dev and
 * critical in prod should not force two catalogues. Absent row = inherit.
 */
export const monitoringJobCheckOverrides = pgTable(
  "monitoring_job_check_overrides",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => monitoringJobs.id, { onDelete: "cascade" }),
    /** Plain text, matching `monitoring_checks.id`; see that table on FKs. */
    checkId: text("check_id").notNull(),
    /** false = excluded from this job's prompt entirely. */
    enabled: boolean("enabled").notNull().default(true),
    /** Replaces the catalogue's base severity for this job only. */
    severityOverride: text("severity_override", {
      enum: ["critical", "high", "medium", "low", "info"],
    }).$type<Severity>(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.checkId] })],
);

/**
 * THE METHODS, as live data — the playbook half of a technology profile, in the
 * same relationship to `lib/monitoring/profiles/*.ts` that `monitoring_checks`
 * has to `catalogue.ts`: the code definition is the reviewed seed, this table is
 * what a deep run actually reads and what the admin screen edits.
 *
 * The primary key is the technology, and there is exactly one row per profiled
 * technology. Playbooks are editable but never creatable or deletable here: a
 * technology that has no playbook also has no vocabulary entry
 * (`WORKLOAD_TECHNOLOGIES`) and no detection rules, so "add a playbook" is a code
 * change by definition and a half-created row would only misreport coverage.
 *
 * There is deliberately no version column: a method is edited and saved, and the
 * text a run was actually given is recorded on the run itself
 * (`monitoring_runs.prompts`, `expected_observations`) rather than reconstructed
 * from a number.
 */
export const monitoringPlaybooks = pgTable("monitoring_playbooks", {
  /** One of WORKLOAD_TECHNOLOGIES. Immutable — it is the join to everything. */
  technology: text("technology")
    .$type<WorkloadTechnology>()
    .primaryKey(),
  /** One paragraph: what this technology dies of, in priority order. */
  framing: text("framing").notNull(),
  /** Where this instance's data lives; `{{namespace}}`/`{{name}}` substituted per target. */
  dataSources: text("data_sources").array().notNull().default([]),
  /** The ordered procedure, most-fatal-first. */
  method: text("method").array().notNull().default([]),
  /** Required measurements. The keys are a permanent trend axis — see monitoring_observations. */
  observations: jsonb("observations")
    .$type<ObservationSpec[]>()
    .notNull()
    .default([]),
  /**
   * Who last edited it; null while the row is still the shipped text.
   *
   * Also the seed guard: a release that rewrites a shipped method refreshes every
   * row that nobody has touched, and leaves an edited one alone. Without it the
   * seed is insert-if-missing forever and new shipped text never reaches an
   * installed database.
   */
  editedBy: uuid("edited_by").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Discovered workload inventory — a CACHE that makes the picker instant and
 * lets the UI flag a selected workload that has since disappeared. Never a
 * source of truth: every discovery run re-stamps `lastSeenAt`.
 */
export const monitoringWorkloads = pgTable(
  "monitoring_workloads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => monitoringClusters.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["deployment", "statefulset"] })
      .$type<WorkloadKind>()
      .notNull(),
    namespace: text("namespace").notNull(),
    name: text("name").notNull(),
    replicas: integer("replicas"),
    images: text("images").array().notNull().default([]),
    /**
     * What discovery inferred is running inside, from images, labels and container
     * names (src/lib/monitoring/technology.ts). Re-derived on every discovery, so
     * it is as disposable as the rest of this cache.
     */
    technology: text("technology").$type<WorkloadTechnology>(),
    /** How that guess was reached, shown in the picker to justify it. */
    technologyReason: text("technology_reason"),
    /**
     * An admin's correction, which always wins. Survives re-discovery precisely
     * because detection cannot see inside a privately-built image, and a wrong
     * guess would otherwise be re-applied every time.
     */
    technologyOverride: text("technology_override").$type<WorkloadTechnology>(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.clusterId, t.kind, t.namespace, t.name),
    index("monitoring_workloads_cluster_idx").on(t.clusterId, t.namespace),
  ],
);

export const monitoringJobs = pgTable(
  "monitoring_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => monitoringClusters.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: ["security", "performance"] })
      .$type<MonitorCategory>()
      .notNull(),
    /**
     * `posture` batches every target into one call (the original behaviour);
     * `deep` runs one investigation per workload against its technology playbook.
     * Existing jobs default to posture, so nothing gets silently more expensive.
     */
    depth: text("depth", { enum: ["posture", "deep"] })
      .$type<MonitorDepth>()
      .notNull()
      .default("posture"),
    model: text("model").notNull(),
    /** 5-field cron expression, UTC. Null = manual runs only. */
    schedule: text("schedule"),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("monitoring_jobs_cluster_idx").on(t.clusterId),
    // The scheduler's due-jobs query.
    index("monitoring_jobs_due_idx").on(t.enabled, t.nextRunAt),
  ],
);

/**
 * The workloads a job assesses. Deliberately DENORMALISED rather than an FK to
 * `monitoring_workloads`: the intent is "the deployment named X in namespace
 * Y", which must survive discovery deleting and recreating inventory rows.
 */
export const monitoringJobTargets = pgTable(
  "monitoring_job_targets",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => monitoringJobs.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: TARGET_KINDS }).$type<TargetKind>().notNull(),
    namespace: text("namespace").notNull(),
    name: text("name").notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.kind, t.namespace, t.name] })],
);

/**
 * One assessment attempt. Also the work queue: rows are inserted `queued` and
 * claimed with `FOR UPDATE SKIP LOCKED`, so overlapping scheduler ticks and
 * future replicas cannot double-run a job.
 */
export const monitoringRuns = pgTable(
  "monitoring_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => monitoringJobs.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["queued", "running", "completed", "failed"],
    })
      .$type<RunStatus>()
      .notNull()
      .default("queued"),
    trigger: text("trigger", { enum: ["manual", "schedule"] })
      .$type<RunTrigger>()
      .notNull(),
    triggeredBy: uuid("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    claimedAt: timestamp("claimed_at"),
    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    attempt: integer("attempt").notNull().default(0),
    model: text("model"),
    costUsd: real("cost_usd"),
    totalTokens: integer("total_tokens"),
    durationMs: integer("duration_ms"),
    /**
     * Holmes returns empty output for a failed tool and carries on, so a
     * "no findings" run where six tools errored is actively misleading.
     * Counted from the response's tool_calls[] and shown on the run.
     */
    toolCallsTotal: integer("tool_calls_total"),
    toolCallsFailed: integer("tool_calls_failed"),
    /**
     * Per-target evaluated/skipped checks — the reconciliation denominator — plus
     * which data sources answered and which were silent.
     */
    coverage: jsonb("coverage").$type<RunCoverage>(),
    /**
     * What this run was SUPPOSED to measure, per target — snapshotted here rather
     * than re-derived from the current playbook when the run page asks.
     *
     * Re-deriving was defensible while a method could only change through a deploy;
     * it is wrong now that an admin can edit one between two runs, because the
     * "missing measurements" panel would grade an old run against a method it was
     * never given. Null on posture runs, which ask for no measurements, and on runs
     * recorded before this column existed.
     */
    expectedObservations: jsonb("expected_observations").$type<
      ExpectedObservations[]
    >(),
    /**
     * The exact prompt sent, per workload — what the agent was ACTUALLY told.
     *
     * Stored rather than re-rendered on demand, because a playbook edit or a check
     * edit makes the original unreconstructable, and "which method produced
     * this answer" is the first question anyone asks of a surprising run. It is also
     * the only way an operator can review the method without reading TypeScript.
     */
    prompts: jsonb("prompts").$type<{ target: string; prompt: string }[]>(),
    /** Findings dropped in validation (unknown check id, foreign target). */
    rejected: jsonb("rejected").$type<string[]>(),
    rawResponse: jsonb("raw_response"),
    error: text("error"),
    findingsNew: integer("findings_new"),
    findingsResolved: integer("findings_resolved"),
    findingsOpen: integer("findings_open"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // The queue claim: WHERE status='queued' ORDER BY created_at.
    index("monitoring_runs_queue_idx").on(t.status, t.createdAt),
    // Run history for a job, newest first.
    index("monitoring_runs_job_idx").on(t.jobId, t.createdAt),
  ],
);

/**
 * A deduplicated, long-lived concern — the thing whose history matters.
 *
 * Identity is `fingerprint`, a sha256 over cluster + target + check + scope
 * computed IN CODE (src/lib/monitoring/fingerprint.ts). Nothing the LLM writes
 * and nothing volatile (pod names, ReplicaSet hashes, image digests) enters the
 * key, because LLM prose drifts between runs and would mint a new concern every
 * time. Keyed per job: the same workload may sit in both a security and a
 * performance job.
 *
 * `baseSeverity` (declared by the check catalogue) is kept alongside
 * `effectiveSeverity` (Holmes, in context) so severity drift is a diffable
 * field rather than a silent rewrite.
 */
export const monitoringConcerns = pgTable(
  "monitoring_concerns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => monitoringJobs.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    checkId: text("check_id").notNull(),
    /** The version of THAT check when this concern was last raised. */
    checkVersion: integer("check_version").notNull().default(1),
    category: text("category", { enum: ["security", "performance"] })
      .$type<MonitorCategory>()
      .notNull(),
    targetKind: text("target_kind", { enum: TARGET_KINDS })
      .$type<TargetKind>()
      .notNull(),
    targetNamespace: text("target_namespace").notNull(),
    targetName: text("target_name").notNull(),
    /** Sub-locus (container, volume, role); "" for whole-workload concerns. */
    scope: text("scope").notNull().default(""),
    baseSeverity: text("base_severity", {
      enum: ["critical", "high", "medium", "low", "info"],
    })
      .$type<Severity>()
      .notNull(),
    effectiveSeverity: text("effective_severity", {
      enum: ["critical", "high", "medium", "low", "info"],
    })
      .$type<Severity>()
      .notNull(),
    severityRationale: text("severity_rationale"),
    status: text("status", {
      enum: [
        "open",
        "resolved",
        "auto_resolved",
        "muted",
        "accepted_risk",
        "false_positive",
      ],
    })
      .$type<ConcernStatus>()
      .notNull()
      .default("open"),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    remediation: text("remediation").notNull(),
    evidence: jsonb("evidence").$type<MonitorEvidence[]>().notNull(),
    /** Hash of the prose/evidence — detects "same concern, changed detail". */
    contentHash: text("content_hash").notNull(),
    firstSeenAt: timestamp("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
    lastResolvedAt: timestamp("last_resolved_at"),
    severityChangedAt: timestamp("severity_changed_at"),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    /** Consecutive runs that evaluated this check and did NOT see it fail. */
    consecutiveRunsAbsent: integer("consecutive_runs_absent")
      .notNull()
      .default(0),
    firstSeenRunId: uuid("first_seen_run_id").references(
      () => monitoringRuns.id,
      { onDelete: "set null" },
    ),
    lastSeenRunId: uuid("last_seen_run_id").references(
      () => monitoringRuns.id,
      { onDelete: "set null" },
    ),
    dismissalReason: text("dismissal_reason"),
    dismissalComment: text("dismissal_comment"),
    dismissedBy: uuid("dismissed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    mutedUntil: timestamp("muted_until"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique().on(t.jobId, t.fingerprint),
    // The concerns list for a job, filtered by lifecycle status.
    index("monitoring_concerns_job_status_idx").on(t.jobId, t.status),
    /**
     * Disabling a check has to find and auto-resolve every concern citing it, and
     * the admin UI counts them before offering a delete. Both filter on
     * `check_id` alone, which no other index leads with.
     */
    index("monitoring_concerns_check_idx").on(t.checkId),
  ],
);

/**
 * MEASURED FACTS, as opposed to verdicts — the trend substrate.
 *
 * Two jobs, neither of which the concern history can do. First, honesty: every row
 * names the source it came from, so "the agent only read the manifest" becomes a
 * query instead of an invisible quality problem. Second, trends: `numeric` makes
 * "WAL grew 4x this week" and "consumer lag is climbing" ordinary SQL rather than
 * a question we have to ask an LLM again.
 *
 * Deliberately NOT deduplicated across runs like concerns are. A concern is one
 * long-lived problem; an observation is a reading at a point in time, and the
 * whole value is in keeping every reading.
 */
export const monitoringObservations = pgTable(
  "monitoring_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => monitoringRuns.id, { onDelete: "cascade" }),
    /** Denormalised, like job targets: a trend is per job, and this keeps it single-table. */
    jobId: uuid("job_id")
      .notNull()
      .references(() => monitoringJobs.id, { onDelete: "cascade" }),
    targetKind: text("target_kind", { enum: TARGET_KINDS })
      .$type<TargetKind>()
      .notNull(),
    targetNamespace: text("target_namespace").notNull(),
    targetName: text("target_name").notNull(),
    /** Stable dotted key from the playbook, e.g. "wal.generation_bytes_per_day". */
    key: text("key").notNull(),
    value: text("value").notNull(),
    /** The same fact as a number when it is one — null when it genuinely is not. */
    numeric: doublePrecision("numeric"),
    unit: text("unit").notNull().default(""),
    source: text("source").$type<ObservationSource>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // One reading per key per workload per run; a repeated key is the model
    // restating itself, not a second measurement.
    unique().on(t.runId, t.targetKind, t.targetNamespace, t.targetName, t.key),
    // The trend query: one workload's series for one key, oldest first.
    index("monitoring_observations_trend_idx").on(
      t.jobId,
      t.targetName,
      t.key,
      t.createdAt,
    ),
    /**
     * `observedKeyCounts` asks "how many readings does each of these keys have",
     * which is what locks a key against renaming. `key` is the third column of the
     * trend index, so that filter could not use it — and this table grows by one
     * row per measurement per workload per run, forever.
     */
    index("monitoring_observations_key_idx").on(t.key),
  ],
);

/**
 * Presence of a concern in a specific run, with the severity as observed then.
 * Powers "the findings of this run" and the per-concern severity timeline —
 * which is why there is no separate concern-events table: machine transitions
 * are derivable from here plus the concern's timestamps, and human lifecycle
 * actions go to `audit_log` via writeAudit().
 */
export const monitoringRunFindings = pgTable(
  "monitoring_run_findings",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => monitoringRuns.id, { onDelete: "cascade" }),
    concernId: uuid("concern_id")
      .notNull()
      .references(() => monitoringConcerns.id, { onDelete: "cascade" }),
    severity: text("severity", {
      enum: ["critical", "high", "medium", "low", "info"],
    })
      .$type<Severity>()
      .notNull(),
    /** True when this run is the one that first opened the concern. */
    isNew: boolean("is_new").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.concernId] })],
);
