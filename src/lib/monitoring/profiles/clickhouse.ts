import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * ClickHouse.
 *
 * Unlike the OLTP engines, ClickHouse's characteristic failures are consequences of
 * how data is WRITTEN and how tables are DESIGNED, not of how they are tuned. Small
 * frequent inserts produce too many parts; a partition key of the wrong shape
 * produces too many parts per insert; a mutation that cannot complete sits there
 * forever without anything alerting. All three are invisible in a Kubernetes spec and
 * all three are answerable from the `system` tables in a few queries.
 *
 * v2 folds in what a year of incidents on THIS cluster taught, distilled from the
 * Altinity engagement (`docs/CLICKHOUSE_PLAYBOOK_INPUT.md`, which also records what was
 * deliberately left out and which agreed fixes are still unverified). The change that
 * matters most is the leading mechanism: v1 blamed small frequent inserts, and the
 * outage was actually write FANOUT — `user_id % 100` as a partition key meant one
 * insert wrote 100 partitions, so no amount of batching at the writer could have
 * helped. Several steps here exist to catch a fix that was agreed and may never have
 * landed, which is exactly the kind of thing an unattended assessment is for.
 */

export const CLICKHOUSE_PLAYBOOK: Playbook = {
  technology: "clickhouse",
  framing:
    "ClickHouse fails from write patterns and schema design far more often than from tuning, and on this cluster the specific killer was write FANOUT from the partition key: a table partitioned by `user_id % 100` wrote every insert into 100 partitions at once, producing 100 small parts per insert no matter how well the writer batched. Part creation then outran merges and everything else followed — merge storms, Keeper overloaded because every part is Keeper state, server restarts slow enough to become outages, and a replication queue so saturated that restores failed. So: check whether writes are at risk right now, then how many partitions an insert actually touches and how large the resulting parts are (5-10 GB is the target here), then whether backpressure exists at all to stop the cluster reaching a state it cannot merge its way out of, then replication and Keeper, then the quiet failures — a stuck mutation that never alerts, a TTL that rewrites data instead of dropping whole parts, an out-of-support server build — and only then query performance. Growth triggers this class of failure but never causes it, so report a partition key that guarantees fanout as critical before it has become symptomatic.",
  dataSources: [
    "SQL: use the read-only ClickHouse query toolset for this cluster, capped at 200 rows — so aggregate. The `system` database is where nearly every answer here lives: `system.parts`, `system.detached_parts`, `system.part_log`, `system.merges`, `system.mutations`, `system.replicas`, `system.replication_queue`, `system.query_log`, `system.errors`, `system.disks`, `system.tables`, `system.backups`, `system.asynchronous_metrics`, `system.metrics`, `system.settings`, `system.zookeeper`.",
    "The database is `optimizer_v1`. Three tables carry the risk: `entity` (wide, ~70 String columns, ReplicatedReplacingMergeTree, weekly partitions, 30-day TTL), `entity_final_states` (historically THE problem table, ~2 billion rows, the one that was partitioned by `user_id % 100`), and `events` (10-day TTL, and no partition key at all). Report the partition key of each as you find it rather than assuming any of them has been fixed.",
    "Metrics: PromQL against Prometheus. This cluster is scraped by the operator's metrics exporter, so ClickHouse series exist — list the available metric names first and match the labels to this workload rather than assuming. Container and PVC series cover the pod itself. Keeper's transaction rate is the best available proxy for part churn: part metadata is Keeper state, so a cluster creating too many parts shows up as Keeper load before it shows up as user-visible slowness.",
    "Logs: the pod logs for {{name}} in namespace {{namespace}}, and Loki for a longer window. Loki labels are app, component, container, filename, job, level, namespace, node_name, pod, stream. IMPORTANT: ClickHouse SERVER logs have historically not been scraped into Loki on this cluster, so verify you can actually see server lines before drawing any conclusion from them — 'no errors in the logs' is not evidence when the logs were never collected, and it is what previously made it impossible to tell a Kubernetes eviction from a ClickHouse crash. Say which of pod logs and Loki you actually read.",
    "Kubernetes: the StatefulSet {{name}} in {{namespace}}, its pods and PVCs, and the Altinity operator resources managing it — a `ClickHouseInstallation` (CHI) carries the shard and replica topology the StatefulSet does not, and Keeper runs as its own `ClickHouseKeeper` workload. Pods are named `chi-<installation>-<cluster>-<shard>-<replica>`; the client service speaks the native protocol on 9000 and replicas fetch parts from each other on 9009. Two operator-level faults have no signature inside ClickHouse at all: a CHI stuck `terminating`, and an operator whose `reconcilePolicy` is the default `delete` rather than `retain` — that default once deleted the CHI outright after a CRD version change and left the cluster unmanageable.",
    "Node: the node each pod is scheduled on, its allocatable CPU and memory. Nodes here are large (on the order of 96 cores and 256 GB) and uniform; an earlier generation mixed them with much slower cloud nodes and the slow ones were a real bottleneck, so if you find heterogeneous nodes serving one cluster, that is a finding. Memory and background-pool settings are judged against the container limit and the node, not against ClickHouse's defaults, which are tuned for small-to-medium clusters.",
    "Backups: `clickhouse-backup` to S3 on a cron. Server-side state is in `system.backups`; the remote inventory needs the `clickhouse-backup list remote` view, where entries can appear as `broken (can't stat metadata.json)`. A broken remote backup blocks incremental backups, and a full backup of this dataset (~2 TB) has timed out before — so treat 'the backup job runs' and 'a restorable backup exists' as different questions.",
  ],
  method: [
    "Establish the topology first, from the operator resources and `system.replicas`: how many shards and replicas, and is this table set replicated at all? Everything about queues and Keeper below is meaningless for a non-replicated table. While you are there, check the two operator-level faults that no SQL query can see — whether the CHI is healthy rather than stuck terminating, and whether the operator's reconcilePolicy is `retain`.",
    "Check whether writes are at risk right now: the maximum active part count in any single partition against parts_to_delay_insert and parts_to_throw_insert. Approaching the first slows every insert; reaching the second rejects them. Then check whether those limits and max_parts_in_total are DELIBERATELY set at all: without backpressure the cluster will keep accepting writes into a state it cannot merge its way out of, and the whole point of the limits is to push the problem back to the writer while recovery is still possible. Backpressure is only safe if the writer retries with a delay, so also report whether inserts were actually delayed or rejected in the window (TOO_MANY_PARTS in `system.errors` or the query log), not just how the counts compare to the thresholds.",
    "Measure write FANOUT, which is the failure this cluster actually had: how many partitions does a single insert touch? Derive it from `system.part_log` (parts created per insert) and read every table's partition key expression from `system.tables`. A modulo expression such as `user_id % 100` is the signature to report — it guarantees one part per partition per insert, it cannot be mitigated at the writer, and it is the difference between an insert creating 1 part and 100. Batching at the writer BY PARTITION KEY is the complementary fix.",
    "Check part SIZE, not only part count: the mean active part size against the 5-10 GB target for this cluster. A small average with an unremarkable count still means merges are churning constantly, and it is the metric that says whether a re-partitioning actually worked.",
    "Only now look at insert shape in `system.query_log` — rows per insert and inserts per minute, and whether async_insert is enabled. Frequent tiny inserts are a client problem and batching or async_insert is the fix, never more background merge threads. Keep this distinct from fanout: they produce the same symptom and have different remedies.",
    "Check for broken and detached parts: counts from `system.detached_parts`, and the max_suspicious_broken_parts tolerance in effect. A replica that refuses to start with 'too many broken parts' is a known failure here rather than data loss — ClickHouse does not fsync by default (deliberately, since fsync would cost far more than it saves), so an abrupt restart such as a Kubernetes eviction can leave zero-byte parts behind. Raising the tolerance lets the replica start, move those parts to detached and refetch them from a healthy replica. Expect it on one replica at a time; a growing detached directory is itself worth reporting.",
    "Check for stuck mutations: entries in `system.mutations` that are not done, with their `latest_fail_reason` and how long they have been outstanding. A failing mutation retries forever, silently, holding parts and disk.",
    "Check replication health: `is_readonly` and `is_session_expired` in `system.replicas` mean the replica has lost its Keeper session and is refusing writes; `absolute_delay`, `queue_size` and `inserts_in_queue` say how far behind it is. Cross-check `system.replication_queue` for entries that keep failing, and compare row counts for the same table across replicas — divergence is a real symptom here. CRITICAL INTERPRETATION RULE: fetch failures (FetchFail / 'fail to fetch') are NORMAL in ClickHouse's asynchronous replication and must NOT be reported as a problem on their own. They are only a symptom when they come with a growing queue, sustained absolute_delay, or 'Broken pipe' and timeout errors. Report the count as context and say explicitly that it is expected background noise.",
    "If fetches genuinely are failing, suspect the network before the database: broken-pipe and timeout errors between replicas have been caused by CNI instability here, not by ClickHouse. Check whether replicas can reach each other on 9000 and 9009, and whether the errors cluster on one replica or one node — that distinction is the whole diagnosis.",
    "Check Keeper load, because part churn is Keeper load: the transaction rate, and any session expiries. A Keeper transaction rate that tracks insert volume rather than data volume points straight back at fanout or tiny inserts.",
    "Check TTL EFFICIENCY, not just TTL existence: is ttl_only_drop_parts enabled, and is each TTL expression aligned to its table's partition boundaries? An aligned TTL drops whole parts, which is nearly free; a misaligned one rewrites parts to remove rows, which turns retention into a permanent expensive background task competing with the merges you need. Also compare configured TTL against the age of the oldest data actually present — retention that is configured but not enforced is common.",
    "Check the server version against its support window, not just its number. An out-of-support build means unpatched bugs and no vendor help, and this cluster ran an unsupported release for months; the LTS line is the one to be on. Report the version and whether it is a supported LTS.",
    "Check memory configuration against the container: max_server_memory_usage (or its ratio form) against the memory limit, and the per-query max_memory_usage against that. Then read `system.errors` and the query log for MEMORY_LIMIT_EXCEEDED, which says the limit is already being hit in practice.",
    "Check the background pools against the machine: background_pool_size, background_fetches_pool_size and the thread pool settings against the node's cores. Operator defaults suit small-to-medium clusters and leave a 96-core box idle. State this as 'the pools are not sized for this node' with the numbers — do NOT recommend raising merge settings as a remedy for part accumulation, which is the mistake this playbook exists to prevent, and note that a high fetches pool (128 here) is a deliberate choice for replica sync rather than an error.",
    "Check query behaviour from `system.query_log`: the heaviest queries by memory and by rows read, and the ratio of rows read to rows returned — a query reading orders of magnitude more than it returns is not using the primary key, which is ClickHouse's equivalent of a missing index. Check whether each table's ORDER BY key matches the filters queries actually use. Include failed queries grouped by exception.",
    "Check storage: free space per disk, growth rate, compression ratio, and the largest tables.",
    "Check that a RESTORABLE backup exists, which is not the same as a backup job that runs: the most recent remote backup that is not broken, and how many remote backups fail metadata validation. Broken entries block incremental backups, and a cron producing broken artefacts is worse than no backup because it reads as protection.",
    "Read the logs last, for the signatures: 'Too many parts', memory limit exceptions, Keeper session losses, broken parts on startup, and merge or mutation failures. If server logs are not collected (see the data sources), say so as a gap rather than reporting a clean log.",
  ],
  observations: [
    { key: "topology.replicated", source: "engine", unit: "", how: "whether the main tables are Replicated*MergeTree" },
    { key: "topology.replica_count", source: "engine", unit: "count", how: "replicas in system.replicas" },
    { key: "version.server", source: "engine", unit: "", how: "ClickHouse server version" },
    { key: "version.lts_supported", source: "engine", unit: "", how: "whether that version is an LTS release still inside its support window" },
    { key: "parts.max_per_partition", source: "engine", unit: "count", how: "highest active part count in any single partition" },
    { key: "parts.worst_table", source: "engine", unit: "", how: "the table holding that partition" },
    { key: "parts.delay_threshold", source: "engine", unit: "count", how: "parts_to_delay_insert in effect" },
    { key: "parts.throw_threshold", source: "engine", unit: "count", how: "parts_to_throw_insert in effect" },
    { key: "parts.max_in_total", source: "engine", unit: "count", how: "max_parts_in_total in effect — the third backpressure limit; report 0 or unset when it is not configured" },
    { key: "parts.total_active", source: "engine", unit: "count", how: "active parts across all tables" },
    { key: "parts.avg_size_bytes", source: "engine", unit: "bytes", how: "mean active part size — the 5-10 GB target is what says whether partitioning is healthy" },
    { key: "parts.detached_count", source: "engine", unit: "count", how: "parts sitting in detached, from system.detached_parts" },
    { key: "parts.broken_count", source: "engine", unit: "count", how: "detached parts whose reason marks them broken or unexpected" },
    { key: "parts.max_suspicious_tolerance", source: "engine", unit: "count", how: "max_suspicious_broken_parts in effect — what decides whether a replica starts after an abrupt restart" },
    { key: "fanout.partitions_per_insert_max", source: "engine", unit: "count", how: "most partitions written by a single insert, from system.part_log — the mechanism behind this cluster's outage" },
    { key: "fanout.modulo_partition_keys", source: "engine", unit: "count", how: "tables whose PARTITION BY is a modulo expression, which guarantees fanout; name them" },
    { key: "merges.in_progress", source: "engine", unit: "count", how: "rows in system.merges" },
    { key: "merges.longest_seconds", source: "engine", unit: "seconds", how: "longest-running merge currently in flight" },
    { key: "mutations.unfinished", source: "engine", unit: "count", how: "mutations in system.mutations that are not done" },
    { key: "mutations.oldest_hours", source: "engine", unit: "hours", how: "age of the oldest unfinished mutation" },
    { key: "mutations.last_fail_reason", source: "engine", unit: "", how: "latest_fail_reason of the worst stuck mutation, empty when none" },
    { key: "inserts.rows_per_insert_median", source: "engine", unit: "rows", how: "median rows per INSERT from system.query_log" },
    { key: "inserts.per_minute", source: "engine", unit: "count", how: "insert queries per minute over the window examined" },
    { key: "inserts.async_enabled", source: "engine", unit: "", how: "whether async_insert is enabled" },
    { key: "inserts.delayed_count", source: "engine", unit: "count", how: "inserts slowed by backpressure in the window examined" },
    { key: "inserts.rejected_count", source: "engine", unit: "count", how: "inserts rejected with TOO_MANY_PARTS in the window examined" },
    { key: "replication.max_absolute_delay_seconds", source: "engine", unit: "seconds", how: "worst absolute_delay in system.replicas" },
    { key: "replication.max_queue_size", source: "engine", unit: "count", how: "worst queue_size in system.replicas" },
    { key: "replication.readonly_replicas", source: "engine", unit: "count", how: "replicas with is_readonly set — usually a lost Keeper session" },
    { key: "replication.session_expired", source: "engine", unit: "count", how: "replicas with is_session_expired set" },
    { key: "replication.fetch_errors", source: "engine", unit: "count", how: "fetch failures in the window — CONTEXT ONLY, expected in normal async replication and not a fault by itself" },
    { key: "replication.row_count_skew_pct", source: "engine", unit: "%", how: "worst row-count divergence for one table between replicas" },
    { key: "keeper.transactions_per_second", source: "metrics", unit: "count", how: "Keeper transaction rate — the proxy for part churn, since part metadata is Keeper state" },
    { key: "config.background_pool_size", source: "engine", unit: "count", how: "merge pool size, to be judged against the node's cores" },
    { key: "config.background_fetches_pool_size", source: "engine", unit: "count", how: "fetch pool size — deliberately high here for replica sync, so report it rather than flagging it" },
    { key: "config.ttl_only_drop_parts", source: "engine", unit: "", how: "whether TTL drops whole parts instead of rewriting them" },
    { key: "schema.ttl_partition_aligned", source: "engine", unit: "", how: "whether each TTL expression is aligned to its table's partition boundaries" },
    { key: "memory.max_server_bytes", source: "engine", unit: "bytes", how: "max_server_memory_usage in effect" },
    { key: "memory.max_query_bytes", source: "engine", unit: "bytes", how: "max_memory_usage per query" },
    { key: "memory.current_bytes", source: "metrics", unit: "bytes", how: "current server memory usage" },
    { key: "pod.memory_limit_bytes", source: "manifest", unit: "bytes", how: "container memory limit — what the memory settings are judged against" },
    { key: "pod.cpu_limit_cores", source: "manifest", unit: "cores", how: "container CPU limit" },
    { key: "node.name", source: "node", unit: "", how: "node this pod is scheduled on" },
    { key: "node.allocatable_memory_bytes", source: "node", unit: "bytes", how: "node allocatable memory" },
    { key: "queries.top_memory_bytes", source: "engine", unit: "bytes", how: "peak memory of the heaviest query in the window" },
    { key: "queries.worst_read_to_result_ratio", source: "engine", unit: "ratio", how: "highest rows-read / rows-returned among significant queries" },
    { key: "queries.failed_count", source: "engine", unit: "count", how: "failed queries in the window examined" },
    { key: "queries.top_exception", source: "engine", unit: "", how: "most frequent exception name, e.g. MEMORY_LIMIT_EXCEEDED or TOO_MANY_PARTS" },
    { key: "schema.max_partitions_per_table", source: "engine", unit: "count", how: "highest partition count on any table" },
    { key: "schema.worst_partitioned_table", source: "engine", unit: "", how: "the table with that partition count, and its partition key" },
    { key: "schema.tables_without_ttl", source: "engine", unit: "count", how: "large append-only tables with no TTL defined" },
    { key: "storage.free_bytes", source: "engine", unit: "bytes", how: "free space from system.disks" },
    { key: "storage.total_bytes", source: "engine", unit: "bytes", how: "total capacity from system.disks" },
    { key: "storage.compression_ratio", source: "engine", unit: "ratio", how: "uncompressed to compressed size across the largest tables" },
    { key: "storage.largest_table_bytes", source: "engine", unit: "bytes", how: "biggest table on disk" },
    { key: "disk.growth_bytes_per_day", source: "metrics", unit: "bytes", how: "PVC growth over the longest retained window" },
    { key: "backup.last_verified_at", source: "engine", unit: "", how: "timestamp of the most recent remote backup that is NOT broken; empty when none is" },
    { key: "backup.broken_remote_count", source: "engine", unit: "count", how: "remote backups failing metadata validation — these block incremental backups" },
    { key: "operator.reconcile_policy", source: "manifest", unit: "", how: "the operator's reconcilePolicy: retain is safe, the delete default can remove the installation" },
    { key: "logs.server_logs_available", source: "logs", unit: "", how: "whether ClickHouse SERVER logs were actually reachable — without them a clean log means nothing" },
    { key: "logs.error_events", source: "logs", unit: "count", how: "error-level lines in the window examined" },
    { key: "logs.window_hours", source: "logs", unit: "hours", how: "how far back the log window actually reaches" },
  ],
};

export const CLICKHOUSE_CHECKS: readonly MonitorCheck[] = [
  {
    id: "CH.TOO_MANY_PARTS",
    category: "performance",
    title: "Part count approaching the insert-rejection threshold",
    baseSeverity: "critical",
    question:
      "What is the highest active part count in any single partition, against parts_to_delay_insert and parts_to_throw_insert? Passing the first slows every insert; reaching the second rejects them outright. Name the table and partition.",
    evidence:
      "The worst partition's part count, both thresholds, the table, and the current insert rate into it.",
    reference: "ClickHouse docs: MergeTree — parts_to_delay_insert / parts_to_throw_insert",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.SMALL_BATCH_INSERTS",
    category: "performance",
    title: "Inserts too small and too frequent",
    baseSeverity: "high",
    question:
      "What is the median rows per INSERT and the insert rate? ClickHouse creates a part per insert, so frequent small inserts are the cause of part accumulation — and the fix belongs at the writer (batching, or async_insert), not in merge settings. Fail when median rows per insert is small enough to be creating parts faster than merges retire them.",
    evidence:
      "Median and distribution of rows per insert, inserts per minute, whether async_insert is enabled, and the resulting part creation rate.",
    reference: "ClickHouse docs: Selecting an Insert Strategy · Asynchronous Inserts",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.STUCK_MUTATION",
    category: "performance",
    title: "Mutation stuck and retrying",
    baseSeverity: "critical",
    question:
      "Are there unfinished mutations in system.mutations, and do any carry a latest_fail_reason? A failing mutation retries indefinitely without alerting anyone, holding parts and disk while appearing to be ordinary background work.",
    evidence:
      "The mutation's table, command, age, parts remaining, and its latest_fail_reason.",
    reference: "ClickHouse docs: system.mutations · ALTER … UPDATE/DELETE",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.REPLICA_READONLY",
    category: "performance",
    title: "Replica read-only or Keeper session lost",
    baseSeverity: "critical",
    question:
      "Do any replicas report is_readonly or is_session_expired? Both mean the replica has lost its coordination session and is refusing writes — the table is up but unwritable, which monitoring that only checks pod health will not notice.",
    evidence:
      "The affected replicas, both flags, the time since the session was lost, and what the log gives as the cause.",
    reference: "ClickHouse docs: system.replicas · Replication and ClickHouse Keeper",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.REPLICATION_LAG",
    category: "performance",
    title: "Replication queue backing up",
    baseSeverity: "high",
    question:
      "What are the worst absolute_delay, queue_size and inserts_in_queue across replicas, and is the queue draining or growing? Cross-check system.replication_queue for entries that keep failing rather than merely waiting.",
    evidence:
      "Per-replica delay and queue depths, the direction over the window, and any repeatedly failing queue entry.",
    reference: "ClickHouse docs: system.replicas · system.replication_queue",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.DISK_RUNWAY",
    category: "performance",
    title: "Disk running out of space",
    baseSeverity: "critical",
    question:
      "What fraction of the disk is used from system.disks, and how many days of headroom remain at the observed growth rate? Fail above 85% used or under 14 days. Merges need free space to work, so ClickHouse degrades before the disk is actually full.",
    evidence:
      "Free and total bytes, the percentage, growth per day, days remaining, and the largest tables contributing.",
    reference: "ClickHouse docs: system.disks · MergeTree storage requirements",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.MEMORY_LIMIT_HIT",
    category: "performance",
    title: "Queries hitting the memory limit",
    baseSeverity: "high",
    question:
      "How many queries failed with MEMORY_LIMIT_EXCEEDED in the window, and what is max_server_memory_usage against the container limit? Report both the configuration and the observed failures — a limit that is never hit is a different finding from one that is.",
    evidence:
      "Failed query count by exception, max_server_memory_usage, max_memory_usage per query, current usage, and the container memory limit.",
    reference: "ClickHouse docs: Memory settings — max_server_memory_usage",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.MEMORY_MISSIZED",
    category: "performance",
    title: "Server memory limit wrong for the container",
    baseSeverity: "high",
    question:
      "Is max_server_memory_usage set relative to the container's memory limit? Left at a host-derived default it either overcommits — inviting an OOM kill that looks like a crash rather than a limit — or wastes the memory the pod is allowed to use.",
    evidence:
      "The configured server memory limit, the container limit, the node's memory, and the resulting ratio.",
    reference: "ClickHouse docs: max_server_memory_usage_to_ram_ratio",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.PARTITION_GRANULARITY",
    category: "performance",
    title: "Partition key too granular",
    baseSeverity: "high",
    question:
      "How many partitions does the largest table have, and what is its partition key? Daily or hourly partitioning on a large table is the most common ClickHouse design error: it multiplies parts, merges and file handles for no query benefit, and monthly is usually correct.",
    evidence:
      "The table, its partition key, partition count, row count, and the part count that results.",
    reference: "ClickHouse docs: Custom Partitioning Key — choosing granularity",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.FULL_SCAN_QUERIES",
    category: "performance",
    title: "Queries reading far more rows than they return",
    baseSeverity: "high",
    question:
      "Which queries read orders of magnitude more rows than they return? That means the primary key is not pruning — ClickHouse's equivalent of a missing index. Report the query shape, rows read, rows returned, and the table's ORDER BY key.",
    evidence:
      "Normalised query text, rows read, rows returned, the ratio, duration, and the table's sorting key.",
    reference: "ClickHouse docs: Primary Indexes · system.query_log",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.SLOW_QUERIES",
    category: "performance",
    title: "Queries dominating time or memory",
    baseSeverity: "high",
    question:
      "Which queries dominate total duration or peak memory in the window? Report them normalised, with call counts, so a cheap query called constantly is distinguishable from one expensive report.",
    evidence:
      "Normalised query text, call count, total and mean duration, peak memory, and rows read.",
    reference: "ClickHouse docs: system.query_log",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.ORDER_BY_MISMATCH",
    category: "performance",
    title: "Sorting key does not match how the table is queried",
    baseSeverity: "medium",
    question:
      "Do the columns most frequently filtered on in the query log appear as a prefix of the table's ORDER BY key? If the common filter is not a prefix, every query scans far more granules than it needs to, and no amount of hardware fixes it.",
    evidence:
      "The table's ORDER BY key, the most common filter columns from the query log, and the read amplification that results.",
    reference: "ClickHouse docs: Primary Indexes — choosing a sorting key",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.NO_TTL_ON_EVENT_TABLE",
    category: "performance",
    title: "Large append-only table with no retention",
    baseSeverity: "medium",
    question:
      "Do the largest append-only tables define a TTL, and where one is defined, is the oldest data actually within it? Retention that is configured but not enforced — or never configured — is how a warehouse volume fills with data nobody queries.",
    evidence:
      "Table name, size, the TTL expression if any, and the age of the oldest partition present.",
    reference: "ClickHouse docs: TTL for Columns and Tables",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
  {
    id: "CH.MERGES_FALLING_BEHIND",
    category: "performance",
    title: "Merges not keeping up",
    baseSeverity: "medium",
    question:
      "Are merges continuously in flight and long-running while part counts stay high? That means background merging cannot keep pace — check the background pool size against the CPU limit before concluding the disk is at fault.",
    evidence:
      "In-flight merge count, longest merge duration, part counts, background pool size, and the CPU limit.",
    reference: "ClickHouse docs: MergeTree background merges · background_pool_size",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.QUERY_FAILURES",
    category: "performance",
    title: "Queries failing repeatedly",
    baseSeverity: "medium",
    question:
      "How many queries failed in the window, and what are the dominant exception names? Group them — TOO_MANY_PARTS, MEMORY_LIMIT_EXCEEDED and TIMEOUT_EXCEEDED each point at a different cause and a different fix.",
    evidence:
      "Failure count, the top exceptions by frequency, and an example query shape for each.",
    reference: "ClickHouse docs: system.query_log · system.errors",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.LOG_ERROR_EVENTS",
    category: "performance",
    title: "Part, merge or Keeper errors in the logs",
    baseSeverity: "high",
    question:
      "Do the logs show 'Too many parts', memory limit exceptions, Keeper session losses, or merge and mutation failures? State the window examined.",
    evidence: "The matching lines with timestamps and frequency, and the window length.",
    reference: "ClickHouse docs: Server logs",
    appliesToTechnologies: ["clickhouse"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "CH.COMPRESSION_POOR",
    category: "performance",
    title: "Compression ratio poor for the data shape",
    baseSeverity: "low",
    question:
      "What compression ratio do the largest tables achieve? A poor ratio on columnar time-series data usually means the sorting key does not group similar values together, or a column-appropriate codec is missing — both cost disk and read bandwidth on every query.",
    evidence:
      "Per-table uncompressed and compressed sizes, the ratio, the sorting key, and any codecs declared.",
    reference: "ClickHouse docs: Column Compression Codecs",
    appliesToTechnologies: ["clickhouse"],
    requires: "engine-sql",
  },
];
