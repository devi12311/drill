import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * MySQL / InnoDB.
 *
 * The ordering principle is the same as PostgreSQL's — what kills you first — but the
 * specific killers differ. MySQL's classic outage is not wraparound, it is the binary
 * log quietly filling the data volume, and its classic silent data-loss risk is a
 * durability setting pair that looks like a performance tweak.
 */

export const MYSQL_PLAYBOOK: Playbook = {
  technology: "mysql",
  framing:
    "MySQL fails in a particular order. It loses data first (a durability setting pair chosen for speed, or replication broken and unnoticed), it stops accepting writes second (the data volume full — usually of binary logs rather than of data), and it gets slow third (a buffer pool too small for the working set, or queries examining orders of magnitude more rows than they return). Memory is the trap that ties them together: MySQL's per-connection buffers are allocated on top of the buffer pool, so a configuration that looks fine at rest is what gets the pod OOMKilled under load.",
  dataSources: [
    "SQL: use the read-only MySQL query toolset for this cluster. It caps results at 200 rows, so aggregate or ORDER BY … LIMIT. `SHOW GLOBAL STATUS`, `SHOW GLOBAL VARIABLES`, `SHOW REPLICA STATUS`, and the `performance_schema`, `information_schema` and `sys` schemas are all readable.",
    "Metrics: PromQL against Prometheus. A mysqld_exporter scrapes this cluster, so `mysql_global_status_*`, `mysql_global_variables_*` and replication series exist — list the available `mysql_` metric names first and match the labels to this workload rather than assuming a value. Container and PVC series (`container_memory_working_set_bytes`, `kubelet_volume_stats_*`) cover the pod itself.",
    "Logs: the pod logs for {{name}} in namespace {{namespace}}, and Loki for a longer window. Loki labels here are app, component, container, filename, job, level, namespace, node_name, pod, stream — there is no service label.",
    "Kubernetes: the StatefulSet {{name}} in {{namespace}}, its pods and PVCs, and any operator resource managing it — an Oracle MySQL Operator `InnoDBCluster` carries group-replication and backup state the StatefulSet does not.",
    "Node: the node each pod is scheduled on, its allocatable CPU and memory and its pressure conditions. Every sizing question below is answered relative to the container limit and the node, never to MySQL's defaults.",
  ],
  method: [
    "Establish the topology: single instance, source with replicas, or a group-replication cluster? Read-only and replication questions are interpreted completely differently for each, and half of them do not apply to a standalone server.",
    "Check durability before performance: the combination of innodb_flush_log_at_trx_commit and sync_binlog decides whether a crash loses committed transactions. Only 1 and 1 is fully durable; anything else is a deliberate trade that should be recorded rather than discovered.",
    "Check replication health and whether anyone would notice it breaking: Seconds_Behind_Source, both threads running, the last error, and any GTID gap. A replica that stopped hours ago and is still serving reads is worse than one that is visibly down.",
    "Check the volume: data directory usage and growth rate, and — separately — how much of it is binary logs. Binlog retention that outlives the disk is MySQL's equivalent of PostgreSQL's abandoned replication slot, and it fills volumes the same way. Include ibtmp1, which grows and never shrinks without a restart.",
    "Size the memory against the container, not the host: innodb_buffer_pool_size versus the memory limit, then the worst case — buffer pool plus per-connection buffers (sort, join, read, read_rnd, tmp_table) multiplied by max_connections. Compare that total to the limit.",
    "Measure whether the buffer pool is actually big enough: read-request versus disk-read rates, free buffers, and wait-free counts. A hit ratio near 100% on a tiny pool means the working set is tiny, not that the pool is right.",
    "Assess query behaviour from performance_schema's statement digest: the worst statements by total latency, and — the more revealing number — those whose rows-examined vastly exceeds rows-sent, which is how a missing index shows up before anyone complains. Note whether the slow query log is even enabled.",
    "Check connections and threads: peak used against max_connections, aborted connects, thread-cache misses, and table-cache pressure from Opened_tables versus table_open_cache.",
    "Check contention: lock waits, deadlock counts, and any transaction in innodb_trx that has been open long enough to be holding history back.",
    "Check schema hygiene where it has operational consequences: tables with no primary key (which make row-based replication scan whole tables), and any surviving MyISAM tables (no crash safety, table-level locking).",
    "Read the logs for the signatures that matter: crash recovery on start, 'Too many connections', aborted connections, InnoDB corruption or assertion messages, and OOM kills.",
  ],
  observations: [
    { key: "topology.role", source: "engine", unit: "", how: "source | replica | standalone | group-member" },
    { key: "topology.replicas_connected", source: "engine", unit: "count", how: "rows in performance_schema.replication_connection_status, or SHOW REPLICAS" },
    { key: "version.server", source: "engine", unit: "", how: "SELECT VERSION()" },
    { key: "durability.flush_log_at_trx_commit", source: "engine", unit: "", how: "innodb_flush_log_at_trx_commit" },
    { key: "durability.sync_binlog", source: "engine", unit: "", how: "sync_binlog" },
    { key: "durability.binlog_enabled", source: "engine", unit: "", how: "log_bin ON/OFF" },
    { key: "replication.seconds_behind", source: "engine", unit: "seconds", how: "worst Seconds_Behind_Source across replicas" },
    { key: "replication.threads_ok", source: "engine", unit: "", how: "true when both IO and SQL/applier threads are running everywhere" },
    { key: "replication.last_error", source: "engine", unit: "", how: "last replication error text, empty when clean" },
    { key: "disk.data_used_pct", source: "metrics", unit: "%", how: "used fraction of the data PVC" },
    { key: "disk.data_capacity_bytes", source: "metrics", unit: "bytes", how: "capacity of the data PVC" },
    { key: "disk.growth_bytes_per_day", source: "metrics", unit: "bytes", how: "PVC growth rate over the longest retained window" },
    { key: "binlog.total_bytes", source: "engine", unit: "bytes", how: "sum of SHOW BINARY LOGS" },
    { key: "binlog.expire_seconds", source: "engine", unit: "seconds", how: "binlog_expire_logs_seconds" },
    { key: "storage.ibtmp1_bytes", source: "engine", unit: "bytes", how: "size of the shared temporary tablespace" },
    { key: "storage.largest_table_bytes", source: "engine", unit: "bytes", how: "biggest table by data+index length" },
    { key: "config.buffer_pool_bytes", source: "engine", unit: "bytes", how: "innodb_buffer_pool_size" },
    { key: "config.buffer_pool_instances", source: "engine", unit: "count", how: "innodb_buffer_pool_instances" },
    { key: "config.max_connections", source: "engine", unit: "count", how: "max_connections" },
    { key: "config.per_connection_worst_case_bytes", source: "engine", unit: "bytes", how: "sort+join+read+read_rnd+tmp_table buffers summed, per connection" },
    { key: "config.slow_query_log", source: "engine", unit: "", how: "slow_query_log and long_query_time; note when logging is off" },
    { key: "config.flush_method", source: "engine", unit: "", how: "innodb_flush_method" },
    { key: "pod.memory_limit_bytes", source: "manifest", unit: "bytes", how: "container memory limit — what every sizing figure is judged against" },
    { key: "pod.cpu_limit_cores", source: "manifest", unit: "cores", how: "container CPU limit" },
    { key: "node.name", source: "node", unit: "", how: "node the primary is scheduled on" },
    { key: "node.allocatable_memory_bytes", source: "node", unit: "bytes", how: "node allocatable memory" },
    { key: "buffer_pool.hit_ratio", source: "engine", unit: "%", how: "1 - (Innodb_buffer_pool_reads / Innodb_buffer_pool_read_requests)" },
    { key: "buffer_pool.wait_free", source: "engine", unit: "count", how: "Innodb_buffer_pool_wait_free — non-zero means the pool is starved" },
    { key: "connections.max_used", source: "engine", unit: "count", how: "Max_used_connections" },
    { key: "connections.aborted", source: "engine", unit: "count", how: "Aborted_connects" },
    { key: "threads.cache_misses", source: "engine", unit: "count", how: "Threads_created relative to Connections" },
    { key: "tables.opened_vs_cache", source: "engine", unit: "", how: "Opened_tables against table_open_cache" },
    { key: "queries.top_total_latency_ms", source: "engine", unit: "ms", how: "worst digest by total latency in events_statements_summary_by_digest" },
    { key: "queries.top_statement", source: "engine", unit: "", how: "the normalised digest text, truncated — never literal values" },
    { key: "queries.worst_examined_to_sent", source: "engine", unit: "ratio", how: "highest rows-examined / rows-sent among significant digests" },
    { key: "queries.tmp_disk_table_ratio", source: "engine", unit: "%", how: "Created_tmp_disk_tables / Created_tmp_tables" },
    { key: "locks.deadlocks", source: "engine", unit: "count", how: "InnoDB deadlock count" },
    { key: "locks.longest_trx_seconds", source: "engine", unit: "seconds", how: "oldest open transaction age in information_schema.innodb_trx" },
    { key: "schema.tables_without_pk", source: "engine", unit: "count", how: "base tables with no primary key" },
    { key: "schema.myisam_tables", source: "engine", unit: "count", how: "surviving MyISAM tables" },
    { key: "logs.error_events", source: "logs", unit: "count", how: "error-level lines in the window examined" },
    { key: "logs.window_hours", source: "logs", unit: "hours", how: "how far back the log window actually reaches" },
  ],
};

export const MYSQL_CHECKS: readonly MonitorCheck[] = [
  {
    id: "MYSQL.DURABILITY_UNSAFE",
    category: "performance",
    title: "Durability settings can lose committed transactions",
    baseSeverity: "critical",
    question:
      "What are innodb_flush_log_at_trx_commit and sync_binlog? Only 1 and 1 survive a crash without losing committed transactions. Fail on any other combination unless the workload is explicitly disposable — and say which value is at fault.",
    evidence:
      "Both values, whether the binary log is enabled, and what a crash would cost at the observed write rate.",
    reference: "MySQL docs: InnoDB Startup Configuration · Binary Logging Options",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.REPLICATION_BROKEN",
    category: "performance",
    title: "Replication stopped or erroring",
    baseSeverity: "critical",
    question:
      "Are both replication threads running on every replica, and is the last error empty? A stopped replica that still serves reads is silently returning stale data, which is worse than being down.",
    evidence:
      "Per-replica thread states, the last error text and its timestamp, and any GTID gap.",
    reference: "MySQL docs: Replication Implementation · SHOW REPLICA STATUS",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.DISK_RUNWAY",
    category: "performance",
    title: "Data volume running out of space",
    baseSeverity: "critical",
    question:
      "What fraction of the data PVC is used, and how many days of headroom remain at the observed growth rate? Fail above 85% used or under 14 days of runway.",
    evidence:
      "Used percentage, capacity, growth per day, and the implied days remaining.",
    reference: "kube-prometheus KubePersistentVolumeFillingUp",
    appliesToTechnologies: ["mysql"],
    requires: "prometheus",
  },
  {
    id: "MYSQL.BINLOG_UNBOUNDED",
    category: "performance",
    title: "Binary logs unbounded against the volume",
    baseSeverity: "critical",
    question:
      "Compare total binary log size and binlog_expire_logs_seconds against the volume's capacity and free space. Fail when retention could plausibly consume the remaining headroom, or when expiry is disabled entirely — this is the most common way a MySQL volume fills.",
    evidence:
      "Total binlog bytes, the expiry setting, PVC capacity and free space, and the observed binlog generation rate.",
    reference: "MySQL docs: Binary Log — binlog_expire_logs_seconds",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.MEMORY_OVERCOMMITTED",
    category: "performance",
    title: "Memory configuration exceeds the container limit",
    baseSeverity: "critical",
    question:
      "Compute innodb_buffer_pool_size + (per-connection buffers × max_connections) and compare it to the container memory limit. Fail when the worst case exceeds the limit — this is the configuration that gets MySQL OOMKilled under load rather than degrading.",
    evidence:
      "Buffer pool size, the per-connection buffer total, max_connections, the computed worst case, and the container limit.",
    reference: "MySQL docs: How MySQL Uses Memory",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.REPLICATION_LAG",
    category: "performance",
    title: "Replica lagging",
    baseSeverity: "high",
    question:
      "What is the worst Seconds_Behind_Source, and is it growing or draining? Fail above 30 seconds sustained. A lag that grows steadily is a different problem from one that spikes and recovers — say which this is.",
    evidence:
      "Per-replica lag, its direction over the observed window, and the applier's parallelism settings.",
    reference: "MySQL docs: Replication Replica Status",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.BUFFER_POOL_UNDERSIZED",
    category: "performance",
    title: "InnoDB buffer pool too small for the working set",
    baseSeverity: "high",
    question:
      "Is the buffer pool a sensible share of the container limit (conventionally 50-70% on a dedicated instance), and does the read-request-to-disk-read ratio show the working set fitting? Report Innodb_buffer_pool_wait_free too — anything above zero means the pool is starved.",
    evidence:
      "Buffer pool size and its percentage of the limit, hit ratio, wait_free count, and free buffers.",
    reference: "MySQL docs: Configuring InnoDB Buffer Pool Size",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.CONNECTIONS_SATURATED",
    category: "performance",
    title: "Connection ceiling nearly reached",
    baseSeverity: "high",
    question:
      "What is Max_used_connections against max_connections? Fail above 85%. Report Aborted_connects as well — a rising abort count with headroom to spare points at authentication or network trouble rather than saturation.",
    evidence: "Max used, the limit, the percentage, and the aborted-connect count.",
    reference: "MySQL docs: Connection Interfaces · Server Status Variables",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.FULL_SCAN_QUERIES",
    category: "performance",
    title: "Queries examining far more rows than they return",
    baseSeverity: "high",
    question:
      "From the statement digest summary, which statements have a rows-examined to rows-sent ratio high enough to indicate a missing index? Report the worst offenders in normalised form with their call counts and total latency.",
    evidence:
      "The digest text, rows examined, rows sent, the ratio, call count and total latency.",
    reference: "MySQL docs: performance_schema statement digest tables",
    appliesToTechnologies: ["mysql"],
    requires: "performance-schema",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.SLOW_QUERIES",
    category: "performance",
    title: "Statements dominating execution time",
    baseSeverity: "high",
    question:
      "Which statements dominate total latency, and which have a mean latency high enough to be user-visible? Report them normalised — never with literal values.",
    evidence:
      "Top digests by total latency with call counts, mean and maximum latency.",
    reference: "MySQL docs: performance_schema statement digest tables",
    appliesToTechnologies: ["mysql"],
    requires: "performance-schema",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.LONG_TRANSACTION",
    category: "performance",
    title: "Long-running open transaction",
    baseSeverity: "high",
    question:
      "Is any transaction in innodb_trx open for longer than a few minutes? A long transaction holds undo history, blocks purge, and grows the history list until performance degrades cluster-wide.",
    evidence:
      "The oldest transaction's age, its state and the statement it is running, plus the history list length.",
    reference: "MySQL docs: information_schema.innodb_trx · InnoDB Multi-Versioning",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.ERROR_LOG_EVENTS",
    category: "performance",
    title: "Crashes, corruption or refused connections in the log",
    baseSeverity: "high",
    question:
      "Do the logs show crash recovery on startup, 'Too many connections', InnoDB assertion or corruption messages, or an OOM kill? State the window examined.",
    evidence: "The matching lines with timestamps and frequency, and the window length.",
    reference: "MySQL docs: The Error Log",
    appliesToTechnologies: ["mysql"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.NO_QUERY_VISIBILITY",
    category: "performance",
    title: "Query performance is unmeasurable",
    baseSeverity: "medium",
    question:
      "Is performance_schema enabled with statement digests collected, and is the slow query log on with a sane long_query_time? If neither holds, slow queries cannot be found at all — the missing instrumentation is itself the finding.",
    evidence:
      "Whether performance_schema is on, the digest table's availability, slow_query_log and long_query_time.",
    reference: "MySQL docs: performance_schema Startup Configuration · The Slow Query Log",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.TMP_TABLES_ON_DISK",
    category: "performance",
    title: "Temporary tables spilling to disk",
    baseSeverity: "medium",
    question:
      "What fraction of created temporary tables end up on disk (Created_tmp_disk_tables / Created_tmp_tables)? Fail above 25% — it means tmp_table_size and max_heap_table_size are too small for the real workload, or the queries need fixing.",
    evidence:
      "Both counters, the ratio, and the current tmp_table_size and max_heap_table_size.",
    reference: "MySQL docs: Internal Temporary Table Use in MySQL",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.DEADLOCKS",
    category: "performance",
    title: "Deadlocks occurring",
    baseSeverity: "medium",
    question:
      "Are deadlocks being recorded, and are they still accumulating? Report the count, the window, and which statements were involved if the log shows them.",
    evidence: "Deadlock count, the accumulation window, and the conflicting statements.",
    reference: "MySQL docs: Deadlocks in InnoDB",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MYSQL.TABLE_CACHE_PRESSURE",
    category: "performance",
    title: "Table or thread cache too small",
    baseSeverity: "medium",
    question:
      "Is Opened_tables growing steadily against table_open_cache, or Threads_created growing against Connections? Both mean a cache is too small and the server is paying to reopen things it should have kept.",
    evidence:
      "Opened_tables, table_open_cache, Threads_created, Connections, and the observed rates.",
    reference: "MySQL docs: How MySQL Opens and Closes Tables",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.IBTMP_BLOAT",
    category: "performance",
    title: "Temporary tablespace grown and never reclaimed",
    baseSeverity: "medium",
    question:
      "How large is the shared temporary tablespace (ibtmp1)? It grows to accommodate the largest temporary workload and is only reclaimed by a restart, so a large file is both wasted space and evidence of a heavy spilling query.",
    evidence:
      "The file size, innodb_temp_data_file_path, and the disk headroom it consumes.",
    reference: "MySQL docs: Temporary Tablespaces",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.TABLES_WITHOUT_PK",
    category: "performance",
    title: "Tables without a primary key",
    baseSeverity: "medium",
    question:
      "Which base tables have no primary key? With row-based replication each such change makes the replica scan the whole table to find the row, which turns a small write into a replication stall.",
    evidence: "The table names, their row estimates, and the replication format in use.",
    reference: "MySQL docs: Replication with Row-Based Format · sql_require_primary_key",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.MYISAM_TABLES",
    category: "performance",
    title: "MyISAM tables still in use",
    baseSeverity: "medium",
    question:
      "Are there surviving MyISAM tables outside the system schemas? MyISAM has no crash safety and locks at table level, so a single write blocks every reader of that table.",
    evidence: "The table names, their sizes, and their access patterns if determinable.",
    reference: "MySQL docs: The MyISAM Storage Engine",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
  {
    id: "MYSQL.FLUSH_METHOD",
    category: "performance",
    title: "InnoDB flush method double-caching",
    baseSeverity: "low",
    question:
      "Is innodb_flush_method set to O_DIRECT? Without it InnoDB pages are cached twice — once in the buffer pool and once in the page cache — which wastes a share of the container's memory limit.",
    evidence: "The setting, the buffer pool size, and the container memory limit.",
    reference: "MySQL docs: InnoDB Startup Configuration — innodb_flush_method",
    appliesToTechnologies: ["mysql"],
    requires: "engine-sql",
  },
];
