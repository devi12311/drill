import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * PostgreSQL: the questions a DBA-minded SRE actually asks, and the method for
 * answering them.
 *
 * Ordering principle throughout: what kills you first. A cluster that stops
 * accepting writes (wraparound, full disk, WAL pinned by a dead slot) outranks a
 * slow query, and an unrecoverable cluster (no working backup) outranks both. The
 * generic performance rubric ranks nothing, because it cannot see any of this.
 */

export const POSTGRESQL_PLAYBOOK: Playbook = {
  technology: "postgresql",
  framing:
    "PostgreSQL fails in a specific order. It becomes unrecoverable (no valid backup, WAL archiving broken) before it becomes unavailable (transaction-ID wraparound, disk full, WAL pinned by an inactive replication slot), and it becomes unavailable long before it becomes merely slow. Investigate in that order, and treat a configuration that cannot survive the node it runs on as a present defect rather than a theoretical one.",
  dataSources: [
    "SQL: use the read-only PostgreSQL query toolset for this cluster. It caps results at 200 rows, so aggregate or ORDER BY … LIMIT rather than selecting raw tables. `SHOW` and the `pg_settings`/`pg_stat_*`/`pg_replication_slots` catalogues are all readable.",
    "Metrics: PromQL against Prometheus. A postgres_exporter scrapes this cluster, so `pg_*` series exist — list the available `pg_` metric names first and match the `instance`/`namespace` labels to this workload rather than assuming a label value. Container-level series (`container_memory_working_set_bytes`, `kubelet_volume_stats_*`) cover the pod and its PVCs.",
    "Logs: the pod logs for {{name}} in namespace {{namespace}}, and Loki for a longer window. Loki labels available here are app, component, container, filename, job, level, namespace, node_name, pod, stream — there is no service label.",
    "Kubernetes: the StatefulSet {{name}} in {{namespace}}, its pods, its PVCs and `volumeClaimTemplates`, plus any operator resource managing it (a CloudNativePG `Cluster`, if present, carries backup and switchover status that the StatefulSet does not).",
    "Node: the node each pod is scheduled on — its allocatable CPU and memory, current pressure conditions, and disk. Configuration questions below are relative to these numbers, so fetch them before answering any of them.",
  ],
  method: [
    "Establish the topology first: is this a primary with standbys, a single instance, or managed by an operator? Everything below is interpreted differently for a single instance, and half of it does not apply to a replica.",
    "Check recoverability before anything else: when did the last successful base backup complete, and is WAL archiving currently succeeding (`pg_stat_archiver`: failed_count, last_failed_time, last_failed_wal)? A cluster with broken archiving has no point-in-time recovery no matter what the backup schedule says.",
    "Check the three ways this cluster stops accepting writes: transaction-ID age against the freeze horizon (`SELECT datname, age(datfrozenxid) FROM pg_database`), free space on the data PVC and its growth rate, and whether any replication slot is inactive while retaining WAL (`pg_replication_slots` where active is false).",
    "Measure replication health: per-standby byte and time lag from `pg_stat_replication`, sync state, and whether the expected number of standbys is actually connected.",
    "Read the configuration and compare it to the container limit and the node, not to defaults: shared_buffers, effective_cache_size, work_mem, maintenance_work_mem, max_connections, max_wal_size, random_page_cost, autovacuum cost settings. Compute the worst case — shared_buffers + (work_mem × max_connections) — and compare it to the pod's memory limit.",
    "Assess vacuum health: dead-tuple ratio and last autovacuum time for the largest and busiest tables, plus any long-running or idle-in-transaction session old enough to be holding the vacuum horizon back.",
    "Assess query behaviour: if pg_stat_statements is available, the top statements by total execution time, by mean time and by variance; otherwise say so, because without it query performance is unmeasurable and that is itself a finding. Cross-check with sequential scans on large tables, cache hit ratio, and temp-file bytes written.",
    "Assess contention and checkpoints: deadlock count, lock waits, and requested-versus-timed checkpoints.",
    "Read the logs for the fatal signatures: PANIC, FATAL, 'too many clients already', statement timeouts, 'checkpoints are occurring too frequently', 'invalid page header', and any OOM kill.",
    "Finally, correlate: if a metric and the configuration disagree with each other, prefer the measured value and say which source you trusted.",
  ],
  observations: [
    { key: "topology.role", source: "engine", unit: "", how: "primary | standby | single — from pg_is_in_recovery()" },
    { key: "topology.standbys_connected", source: "engine", unit: "count", how: "rows in pg_stat_replication" },
    { key: "version.server", source: "engine", unit: "", how: "SHOW server_version" },
    { key: "backup.last_successful_age_hours", source: "engine", unit: "hours", how: "age of the newest completed base backup, from the operator resource or archiver state" },
    { key: "wal.archiver_failed_count", source: "engine", unit: "count", how: "pg_stat_archiver.failed_count" },
    { key: "wal.archiver_last_failure", source: "engine", unit: "", how: "pg_stat_archiver.last_failed_time and last_failed_wal, or empty when clean" },
    { key: "wal.directory_bytes", source: "engine", unit: "bytes", how: "total size of pg_wal" },
    { key: "wal.generation_bytes_per_day", source: "metrics", unit: "bytes", how: "WAL bytes written per day, from the exporter's WAL counters over the longest window available" },
    { key: "wal.inactive_slots", source: "engine", unit: "count", how: "pg_replication_slots where active is false" },
    { key: "wal.max_slot_retained_bytes", source: "engine", unit: "bytes", how: "largest WAL volume retained by any single slot" },
    { key: "xid.max_datfrozenxid_age", source: "engine", unit: "transactions", how: "max(age(datfrozenxid)) across pg_database" },
    { key: "xid.autovacuum_freeze_max_age", source: "engine", unit: "transactions", how: "the configured freeze horizon it is racing" },
    { key: "disk.data_used_pct", source: "metrics", unit: "%", how: "used fraction of the data PVC, from kubelet_volume_stats_*" },
    { key: "disk.data_capacity_bytes", source: "metrics", unit: "bytes", how: "capacity of the data PVC" },
    { key: "disk.growth_bytes_per_day", source: "metrics", unit: "bytes", how: "PVC growth rate over the longest window Prometheus retains" },
    { key: "db.total_size_bytes", source: "engine", unit: "bytes", how: "sum of pg_database_size across databases" },
    { key: "replication.max_lag_bytes", source: "engine", unit: "bytes", how: "worst standby lag in bytes from pg_stat_replication" },
    { key: "replication.max_lag_seconds", source: "engine", unit: "seconds", how: "worst standby replay lag in seconds" },
    { key: "config.shared_buffers_bytes", source: "engine", unit: "bytes", how: "SHOW shared_buffers, normalised to bytes" },
    { key: "config.effective_cache_size_bytes", source: "engine", unit: "bytes", how: "SHOW effective_cache_size, normalised to bytes" },
    { key: "config.work_mem_bytes", source: "engine", unit: "bytes", how: "SHOW work_mem, normalised to bytes" },
    { key: "config.maintenance_work_mem_bytes", source: "engine", unit: "bytes", how: "SHOW maintenance_work_mem, normalised to bytes" },
    { key: "config.max_connections", source: "engine", unit: "count", how: "SHOW max_connections" },
    { key: "config.max_wal_size_bytes", source: "engine", unit: "bytes", how: "SHOW max_wal_size, normalised to bytes" },
    { key: "config.random_page_cost", source: "engine", unit: "", how: "SHOW random_page_cost" },
    { key: "config.pg_stat_statements_available", source: "engine", unit: "", how: "true when the extension is installed and readable" },
    { key: "config.log_min_duration_statement_ms", source: "engine", unit: "ms", how: "SHOW log_min_duration_statement; -1 means slow queries are never logged" },
    { key: "pod.memory_limit_bytes", source: "manifest", unit: "bytes", how: "the container's memory limit — the number every config value above is judged against" },
    { key: "pod.cpu_limit_cores", source: "manifest", unit: "cores", how: "the container's CPU limit" },
    { key: "node.name", source: "node", unit: "", how: "the node the primary is scheduled on" },
    { key: "node.allocatable_memory_bytes", source: "node", unit: "bytes", how: "the node's allocatable memory" },
    { key: "node.transparent_hugepages", source: "node", unit: "", how: "always | madvise | never — 'always' is actively harmful to PostgreSQL" },
    { key: "connections.peak_used", source: "metrics", unit: "count", how: "peak backend count over the retained window" },
    { key: "connections.idle_in_transaction_max_age_seconds", source: "engine", unit: "seconds", how: "oldest session in state 'idle in transaction'" },
    { key: "vacuum.max_dead_tuple_ratio", source: "engine", unit: "%", how: "worst n_dead_tup/(n_live_tup+n_dead_tup) among tables above a meaningful row count" },
    { key: "vacuum.oldest_autovacuum_age_hours", source: "engine", unit: "hours", how: "age of the oldest last_autovacuum among busy tables" },
    { key: "queries.top_total_time_ms", source: "engine", unit: "ms", how: "total_exec_time of the single worst statement in pg_stat_statements" },
    { key: "queries.top_statement", source: "engine", unit: "", how: "a truncated, parameter-free form of that statement — never include literal values" },
    { key: "queries.cache_hit_ratio", source: "engine", unit: "%", how: "blks_hit/(blks_hit+blks_read) across databases" },
    { key: "queries.temp_bytes", source: "engine", unit: "bytes", how: "pg_stat_database.temp_bytes — spill to disk means work_mem is too small" },
    { key: "queries.seq_scan_heavy_tables", source: "engine", unit: "count", how: "tables above a meaningful size whose seq_scan greatly exceeds idx_scan" },
    { key: "locks.deadlocks", source: "engine", unit: "count", how: "pg_stat_database.deadlocks" },
    { key: "checkpoints.requested_ratio", source: "engine", unit: "%", how: "requested checkpoints as a fraction of all checkpoints" },
    { key: "logs.fatal_events", source: "logs", unit: "count", how: "count of PANIC/FATAL lines in the window examined" },
    { key: "logs.window_hours", source: "logs", unit: "hours", how: "how far back the log window you actually read reaches" },
  ],
};

export const POSTGRESQL_CHECKS: readonly MonitorCheck[] = [
  {
    id: "PG.BACKUP_STALE",
    category: "performance",
    title: "No recent successful backup",
    baseSeverity: "critical",
    question:
      "When did the last base backup complete successfully, and is that within the recovery-point objective this cluster is supposed to meet? Treat 'no backup evidence found anywhere' as a failure, not as unknown — a backup nobody can point to does not exist.",
    evidence:
      "The timestamp and source of the last successful backup, or the specific place you looked and found none.",
    reference: "PostgreSQL docs: Continuous Archiving and Point-in-Time Recovery",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.WAL_ARCHIVE_FAILING",
    category: "performance",
    title: "WAL archiving is failing",
    baseSeverity: "critical",
    question:
      "Does pg_stat_archiver show archiving failures — a non-zero failed_count with a recent last_failed_time? Failing archiving means point-in-time recovery is broken and WAL will accumulate until the disk fills.",
    evidence:
      "failed_count, last_failed_time, last_failed_wal, and how far behind the last successfully archived segment is.",
    reference: "PostgreSQL docs: pg_stat_archiver · Continuous Archiving",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.XID_WRAPAROUND_RISK",
    category: "performance",
    title: "Transaction ID wraparound approaching",
    baseSeverity: "critical",
    question:
      "What is the largest age(datfrozenxid) across databases, as a fraction of autovacuum_freeze_max_age and of the 2-billion hard limit? Fail above 50% of the hard limit. This is the failure mode where PostgreSQL stops accepting writes entirely.",
    evidence:
      "The worst database, its datfrozenxid age, autovacuum_freeze_max_age, and the resulting headroom in transactions.",
    reference:
      "PostgreSQL docs: Routine Vacuuming — Preventing Transaction ID Wraparound Failures",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.DISK_RUNWAY",
    category: "performance",
    title: "Data volume running out of space",
    baseSeverity: "critical",
    question:
      "What fraction of the data PVC is used, and at the observed growth rate how many days of headroom remain? Fail above 85% used, or under 14 days of runway at the current rate.",
    evidence:
      "Used percentage, capacity, observed growth per day, and the implied days remaining.",
    reference: "kube-prometheus KubePersistentVolumeFillingUp",
    appliesToTechnologies: ["postgresql"],
    requires: "prometheus",
  },
  {
    id: "PG.WAL_PINNED_BY_SLOT",
    category: "performance",
    title: "Inactive replication slot retaining WAL",
    baseSeverity: "critical",
    question:
      "Is any replication slot inactive (active = false) while still retaining WAL? An abandoned slot pins WAL forever and is the single most common way a PostgreSQL data volume fills up.",
    evidence:
      "The slot name, its type, whether it is active, and the WAL volume it is retaining.",
    reference: "PostgreSQL docs: Replication Slots · pg_replication_slots",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.MEMORY_OVERCOMMITTED",
    category: "performance",
    title: "Memory configuration exceeds the container limit",
    baseSeverity: "critical",
    question:
      "Compute shared_buffers + (work_mem × max_connections) and compare it to the container's memory limit. Fail when the worst case exceeds the limit: this is the configuration that gets PostgreSQL OOMKilled under load rather than degrading.",
    evidence:
      "shared_buffers, work_mem, max_connections, the computed worst case, and the container memory limit.",
    reference: "PostgreSQL docs: Resource Consumption · pgtune sizing guidance",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.REPLICATION_LAG",
    category: "performance",
    title: "Standby replication lagging",
    baseSeverity: "high",
    question:
      "What is the worst standby lag in bytes and in seconds from pg_stat_replication? Fail above 30 seconds of replay lag, or when a standby's lag is growing rather than holding steady.",
    evidence:
      "Per-standby application_name, state, sync_state, write/flush/replay lag in bytes and seconds.",
    reference: "PostgreSQL docs: pg_stat_replication · Hot Standby",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.NO_STANDBY",
    category: "performance",
    title: "No streaming standby",
    baseSeverity: "high",
    question:
      "Does this cluster have at least one connected streaming standby? A single-instance PostgreSQL has no failover path, and node loss becomes a restore from backup rather than a promotion.",
    evidence:
      "The number of connected standbys, and the operator's declared instance count if one manages this cluster.",
    reference: "PostgreSQL docs: High Availability, Load Balancing, and Replication",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.AUTOVACUUM_BEHIND",
    category: "performance",
    title: "Autovacuum not keeping up",
    baseSeverity: "high",
    question:
      "For the largest and busiest tables, what is the dead-tuple ratio and how long since the last autovacuum? Fail when a substantial table is above 20% dead tuples, or has not been autovacuumed within a day despite ongoing writes.",
    evidence:
      "The worst tables by dead-tuple ratio with their live/dead counts, last_autovacuum, and the autovacuum cost settings in force.",
    reference: "PostgreSQL docs: Routine Vacuuming · pg_stat_user_tables",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.IDLE_IN_TRANSACTION",
    category: "performance",
    title: "Long idle-in-transaction sessions",
    baseSeverity: "high",
    question:
      "Is any session in state 'idle in transaction' for longer than a few minutes? Such a session holds the vacuum horizon open, so bloat accumulates cluster-wide until it is closed.",
    evidence:
      "The oldest such session's age, its application_name and client address, and whether idle_in_transaction_session_timeout is set.",
    reference: "PostgreSQL docs: pg_stat_activity · Routine Vacuuming",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.CONNECTIONS_SATURATED",
    category: "performance",
    title: "Connection ceiling nearly reached",
    baseSeverity: "high",
    question:
      "What is the peak backend count against max_connections over the observed window? Fail above 85%. Also report whether a connection pooler sits in front, because without one every client process is a backend.",
    evidence:
      "Peak used connections, max_connections, the resulting percentage, and whether a pooler is present.",
    reference: "PostgreSQL docs: Connections and Authentication",
    appliesToTechnologies: ["postgresql"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.FATAL_LOG_EVENTS",
    category: "performance",
    title: "Fatal errors or corruption in the logs",
    baseSeverity: "high",
    question:
      "Do the logs contain PANIC, FATAL, 'too many clients already', 'invalid page header', 'could not resize shared memory', or evidence of an OOM kill? State the window you examined.",
    evidence:
      "The matching log lines with timestamps, their frequency, and the length of the window read.",
    reference: "PostgreSQL docs: Error Reporting and Logging",
    appliesToTechnologies: ["postgresql"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.SLOW_QUERIES",
    category: "performance",
    title: "Queries dominating execution time",
    baseSeverity: "high",
    question:
      "From pg_stat_statements, which statements dominate total execution time, and which have a mean time high enough to be user-visible? Report the worst offenders with calls, mean and total time — parameter-free, never with literal values.",
    evidence:
      "The top statements by total_exec_time with calls, mean_exec_time, stddev and rows, in normalised form.",
    reference: "PostgreSQL docs: pg_stat_statements",
    appliesToTechnologies: ["postgresql"],
    requires: "pg-stat-statements",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.NO_QUERY_VISIBILITY",
    category: "performance",
    title: "Query performance is unmeasurable",
    baseSeverity: "medium",
    question:
      "Is pg_stat_statements installed and readable, and is log_min_duration_statement set to something other than -1? If neither holds, slow queries cannot be found at all — the absence of instrumentation is the finding.",
    evidence:
      "Whether the extension is present, the value of log_min_duration_statement, and shared_preload_libraries.",
    reference: "PostgreSQL docs: pg_stat_statements · Error Reporting and Logging",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.TEMP_FILE_SPILL",
    category: "performance",
    title: "Queries spilling to temporary files",
    baseSeverity: "medium",
    question:
      "How many temporary-file bytes has this cluster written (pg_stat_database.temp_bytes), and is the rate significant? Spilling means work_mem is too small for the real workload, so sorts and hashes hit disk.",
    evidence: "temp_files, temp_bytes, the observed rate, and the current work_mem.",
    reference: "PostgreSQL docs: pg_stat_database · Resource Consumption",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.SEQ_SCAN_HEAVY",
    category: "performance",
    title: "Sequential scans on large tables",
    baseSeverity: "medium",
    question:
      "Which tables above a meaningful row count are read mostly by sequential scan rather than index scan? Report the table, its size, and the scan counts — a missing index shows up here before it shows up in a complaint.",
    evidence:
      "Table name, live row estimate, seq_scan and idx_scan counts, and rows read per scan.",
    reference: "PostgreSQL docs: pg_stat_user_tables · Using Explain",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.CACHE_HIT_LOW",
    category: "performance",
    title: "Buffer cache hit ratio low",
    baseSeverity: "medium",
    question:
      "What is blks_hit/(blks_hit+blks_read) for the active databases? Fail below 95% on an OLTP workload — sustained misses mean shared_buffers is too small for the working set, or the working set has outgrown the node.",
    evidence: "The ratio per database, shared_buffers, and the container memory limit.",
    reference: "PostgreSQL docs: pg_stat_database · Resource Consumption",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.SHARED_BUFFERS_MISSIZED",
    category: "performance",
    title: "shared_buffers wrong for the container",
    baseSeverity: "medium",
    question:
      "Is shared_buffers roughly a quarter of the container's memory limit? Fail when it is below 10% or above 40% of the limit — both waste the memory the pod is actually allowed to use.",
    evidence:
      "shared_buffers in bytes, the container memory limit, and the resulting percentage.",
    reference: "PostgreSQL docs: Resource Consumption · pgtune",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.EFFECTIVE_CACHE_SIZE_WRONG",
    category: "performance",
    title: "effective_cache_size misleads the planner",
    baseSeverity: "low",
    question:
      "Is effective_cache_size set to roughly 50-75% of the memory actually available to this pod? It changes no allocation, only the planner's index-versus-scan decisions, so a default value on a large pod produces systematically bad plans.",
    evidence:
      "effective_cache_size, the container memory limit, and the resulting percentage.",
    reference: "PostgreSQL docs: Planner Cost Constants",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.RANDOM_PAGE_COST_SSD",
    category: "performance",
    title: "random_page_cost still set for spinning disks",
    baseSeverity: "low",
    question:
      "Is random_page_cost still 4.0 while the data volume is SSD or network-attached flash? The default assumes rotational media and pushes the planner away from index scans it should be choosing.",
    evidence:
      "random_page_cost, seq_page_cost, and the storage class or disk type behind the PVC.",
    reference: "PostgreSQL docs: Planner Cost Constants",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.MAX_WAL_SIZE_VS_DISK",
    category: "performance",
    title: "max_wal_size unsafe against the volume",
    baseSeverity: "medium",
    question:
      "Compare max_wal_size and any WAL keep settings against the data volume's capacity and free space. Fail when WAL alone could plausibly consume the remaining headroom, or when it is so small that checkpoints are forced constantly.",
    evidence:
      "max_wal_size, min_wal_size, wal_keep_size, current pg_wal size, and PVC capacity and free space.",
    reference: "PostgreSQL docs: Write Ahead Log configuration",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.CHECKPOINTS_TOO_FREQUENT",
    category: "performance",
    title: "Checkpoints forced by WAL volume",
    baseSeverity: "medium",
    question:
      "What fraction of checkpoints are requested rather than timed? Fail above 25% — it means max_wal_size is too small for the write rate, and every forced checkpoint is an I/O spike users can feel.",
    evidence:
      "Requested and timed checkpoint counts, checkpoint_timeout, max_wal_size, and any 'checkpoints are occurring too frequently' log lines.",
    reference: "PostgreSQL docs: WAL Configuration · pg_stat_bgwriter",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.DEADLOCKS",
    category: "performance",
    title: "Deadlocks occurring",
    baseSeverity: "medium",
    question:
      "Does pg_stat_database report deadlocks, and are they still accumulating? Report the count and, from the logs, which statements were involved.",
    evidence:
      "The deadlock count, the window it accumulated over, and the conflicting statements from the logs.",
    reference: "PostgreSQL docs: Explicit Locking · pg_stat_database",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PG.UNUSED_INDEXES",
    category: "performance",
    title: "Unused indexes carrying write cost",
    baseSeverity: "low",
    question:
      "Which indexes have idx_scan at or near zero despite a meaningful uptime, and how much space and write amplification do they cost? Exclude primary keys, unique constraints, and anything younger than the statistics window.",
    evidence:
      "Index name, table, size, idx_scan count, and how long statistics have been accumulating.",
    reference: "PostgreSQL docs: pg_stat_user_indexes",
    appliesToTechnologies: ["postgresql"],
    requires: "engine-sql",
  },
  {
    id: "PG.THP_ENABLED",
    category: "performance",
    title: "Transparent huge pages enabled on the node",
    baseSeverity: "medium",
    question:
      "Is transparent huge pages set to 'always' on the node running this database? THP causes latency spikes and memory bloat in PostgreSQL's shared-buffer access pattern and is conventionally set to 'madvise' or 'never' on database nodes.",
    evidence:
      "The node name and the effective THP setting, plus how you read it.",
    reference: "PostgreSQL wiki: Tuning Your PostgreSQL Server — huge pages",
    appliesToTechnologies: ["postgresql"],
    requires: "node",
  },
];
