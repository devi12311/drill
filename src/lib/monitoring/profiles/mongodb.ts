import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * MongoDB.
 *
 * Two things dominate this profile and neither is visible from a Kubernetes spec:
 * the oplog window, which decides whether a replica that falls behind can catch up
 * or needs a full resync, and the concurrency ticket pool, which is the one
 * unambiguous saturation signal MongoDB exposes.
 */

export const MONGODB_PLAYBOOK: Playbook = {
  technology: "mongodb",
  framing:
    "MongoDB rarely announces its problems. The failure that hurts most is a replica falling further behind than the oplog retains, which turns a brief outage into a full resync of the whole dataset; the failure that hurts most often is a query with no index quietly scanning a collection. In between sits the WiredTiger cache, whose default size is derived from the HOST's memory and is therefore wrong on almost every containerised deployment. Read the oplog window and the ticket pool before anything else — they are the two numbers that tell you how close this is to the edge.",
  dataSources: [
    "Database: use the read-only MongoDB toolset for this cluster. It exposes the diagnostic command surface — server status, replica-set status, current operations, WiredTiger statistics, collection and index statistics. Queries are read-only, so prefer aggregation and explain over anything that writes.",
    "Metrics: PromQL against Prometheus. A mongodb_exporter scrapes this cluster, so `mongodb_*` series exist — list the available `mongodb_` metric names first and match the labels to this workload rather than assuming. Container and PVC series cover the pod itself.",
    "Logs: the pod logs for {{name}} in namespace {{namespace}}, and Loki for a longer window. MongoDB logs slow operations above a threshold by default, so the logs are a genuine source of query evidence here, not just of errors. Loki labels are app, component, container, filename, job, level, namespace, node_name, pod, stream.",
    "Kubernetes: the StatefulSet {{name}} in {{namespace}}, its pods and PVCs, and any operator resource — a Percona `PerconaServerMongoDB` carries backup and sharding state the StatefulSet does not.",
    "Node: the node each pod is scheduled on and its allocatable memory. The WiredTiger cache question below is answered against the container limit AND the node, because MongoDB's own default is computed from neither.",
  ],
  method: [
    "Establish the topology: how many members, in what states, and is this a genuine replica set or a single-node one? A single-node replica set has the replication machinery without any of the redundancy, and everything below is read differently for it.",
    "Compute the oplog window in hours — the time between the oldest and newest oplog entry. This is the single most important number here: it is how long a member may be offline and still catch up without a full resync. Compare it against how long a node drain, a backup or a maintenance window actually takes.",
    "Check per-member replication lag and the election history. Frequent elections mean something is flapping, and a member that is behind but inside the oplog window is a different severity from one that has fallen outside it.",
    "Check saturation via the concurrency tickets: available read and write tickets against their totals. Exhausted tickets are unambiguous saturation — unlike CPU, which a MongoDB under lock contention will not show.",
    "Size the WiredTiger cache against the container limit. The default is derived from host RAM, so on a limited container it is usually far too large (inviting an OOM kill) or far too small (leaving the limit unused). Then check eviction pressure: dirty and tracked bytes against their trigger thresholds, and whether application threads are being forced to evict.",
    "Find the queries with no index: the profiler or the slow-operation log lines whose plan summary is COLLSCAN, on collections large enough for it to matter. This is the most common MongoDB performance bug and it is invisible until the collection grows.",
    "Check index health from the other side: unused indexes from index statistics, which cost write throughput and space for nothing.",
    "Check durability posture: the default write concern, whether journaling is on, and the read concern in use. w:1 acknowledges before the write is replicated, so a primary failover can lose it.",
    "Check storage: dbPath usage and growth, and storage size against data size — a large gap is fragmentation, which is reclaimable but only deliberately.",
    "Check connections: current against available, and the churn rate. Drivers that open a connection per request show up here long before they show up as latency.",
    "Read the logs for the signatures: elections, 'not primary' errors, WiredTiger errors, connection storms, and OOM kills.",
  ],
  observations: [
    { key: "topology.member_count", source: "engine", unit: "count", how: "replica-set members configured" },
    { key: "topology.role", source: "engine", unit: "", how: "primary | secondary | standalone" },
    { key: "topology.unhealthy_members", source: "engine", unit: "count", how: "members not in PRIMARY or SECONDARY state" },
    { key: "version.server", source: "engine", unit: "", how: "server version" },
    { key: "oplog.window_hours", source: "engine", unit: "hours", how: "time span between oldest and newest oplog entry — the resync safety margin" },
    { key: "oplog.size_bytes", source: "engine", unit: "bytes", how: "configured oplog size" },
    { key: "replication.max_lag_seconds", source: "engine", unit: "seconds", how: "worst member replication lag" },
    { key: "replication.elections_recent", source: "logs", unit: "count", how: "elections observed in the log window" },
    { key: "tickets.read_available", source: "engine", unit: "count", how: "available read tickets" },
    { key: "tickets.write_available", source: "engine", unit: "count", how: "available write tickets" },
    { key: "tickets.total", source: "engine", unit: "count", how: "configured concurrent transaction limit" },
    { key: "cache.configured_bytes", source: "engine", unit: "bytes", how: "WiredTiger cache size in effect" },
    { key: "cache.used_bytes", source: "engine", unit: "bytes", how: "bytes currently in cache" },
    { key: "cache.dirty_bytes", source: "engine", unit: "bytes", how: "tracked dirty bytes in cache" },
    { key: "cache.pages_read_into", source: "engine", unit: "count", how: "pages read into cache — the cache-miss signal" },
    { key: "cache.app_threads_evicting", source: "engine", unit: "count", how: "application threads forced into eviction; above zero means pressure" },
    { key: "pod.memory_limit_bytes", source: "manifest", unit: "bytes", how: "container memory limit — what the cache size is judged against" },
    { key: "pod.cpu_limit_cores", source: "manifest", unit: "cores", how: "container CPU limit" },
    { key: "node.name", source: "node", unit: "", how: "node the primary is scheduled on" },
    { key: "node.allocatable_memory_bytes", source: "node", unit: "bytes", how: "node allocatable memory" },
    { key: "queries.collscan_ops", source: "logs", unit: "count", how: "slow operations whose plan summary is COLLSCAN, in the window examined" },
    { key: "queries.worst_collscan_collection", source: "logs", unit: "", how: "the collection most often scanned without an index" },
    { key: "queries.slowest_op_ms", source: "logs", unit: "ms", how: "slowest operation duration observed" },
    { key: "queries.longest_running_op_seconds", source: "engine", unit: "seconds", how: "oldest operation currently in progress" },
    { key: "indexes.unused_count", source: "engine", unit: "count", how: "indexes with no accesses since statistics were reset" },
    { key: "durability.default_write_concern", source: "engine", unit: "", how: "default write concern, e.g. w:1 or majority" },
    { key: "durability.journal_enabled", source: "engine", unit: "", how: "whether journaling is enabled" },
    { key: "storage.data_size_bytes", source: "engine", unit: "bytes", how: "logical data size across databases" },
    { key: "storage.storage_size_bytes", source: "engine", unit: "bytes", how: "allocated storage size — the gap to data size is fragmentation" },
    { key: "disk.data_used_pct", source: "metrics", unit: "%", how: "used fraction of the dbPath PVC" },
    { key: "disk.growth_bytes_per_day", source: "metrics", unit: "bytes", how: "PVC growth over the longest retained window" },
    { key: "connections.current", source: "engine", unit: "count", how: "current connections" },
    { key: "connections.available", source: "engine", unit: "count", how: "remaining connection headroom" },
    { key: "logs.error_events", source: "logs", unit: "count", how: "error-level lines in the window examined" },
    { key: "logs.window_hours", source: "logs", unit: "hours", how: "how far back the log window actually reaches" },
  ],
};

export const MONGODB_CHECKS: readonly MonitorCheck[] = [
  {
    id: "MONGO.OPLOG_WINDOW_SHORT",
    category: "performance",
    title: "Oplog window too short to survive a maintenance window",
    baseSeverity: "critical",
    question:
      "How many hours does the oplog span? Fail below 24 hours. A member offline for longer than this window cannot catch up and needs a full resync of the entire dataset — compare the window against how long a node drain or a backup actually takes here.",
    evidence:
      "The window in hours, the oplog size, the write rate consuming it, and the longest routine maintenance operation for comparison.",
    reference: "MongoDB docs: Replica Set Oplog — oplog size and replication window",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.MEMBER_UNHEALTHY",
    category: "performance",
    title: "Replica set member not healthy",
    baseSeverity: "critical",
    question:
      "Are all configured members in PRIMARY or SECONDARY state? Report anything in RECOVERING, STARTUP2, DOWN or ROLLBACK, and how long it has been there.",
    evidence:
      "Per-member state, uptime, last heartbeat, and the error if the set reports one.",
    reference: "MongoDB docs: Replica Set Member States",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.SINGLE_NODE_SET",
    category: "performance",
    title: "Single-node replica set — no failover",
    baseSeverity: "high",
    question:
      "Does this replica set have only one data-bearing member? That configuration carries all the replication machinery and none of the redundancy: node loss is a restore, not a failover.",
    evidence:
      "The member count and their roles, plus whether an arbiter is masquerading as redundancy.",
    reference: "MongoDB docs: Replica Set Deployment Architectures",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.TICKETS_EXHAUSTED",
    category: "performance",
    title: "Concurrency tickets exhausted",
    baseSeverity: "high",
    question:
      "How many read and write tickets are available against the total? Approaching zero is unambiguous saturation — operations are queueing for the right to execute. Unlike CPU, this cannot be explained away.",
    evidence:
      "Available read and write tickets, the configured total, and the queue depths alongside.",
    reference: "MongoDB docs: WiredTiger concurrent transactions (ticket) limits",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.CACHE_MISSIZED",
    category: "performance",
    title: "WiredTiger cache wrong for the container",
    baseSeverity: "high",
    question:
      "Compare the effective WiredTiger cache size against the container memory limit. MongoDB's default is computed from the HOST's memory, so on a limited container it is usually far too large — inviting an OOM kill — or far too small, leaving the limit unused. Fail when the cache exceeds ~60% of the limit or falls below ~25% of it.",
    evidence:
      "The configured cache size, the container memory limit, the node's memory, and the resulting percentage.",
    reference: "MongoDB docs: WiredTiger Storage Engine — cacheSizeGB",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.CACHE_EVICTION_PRESSURE",
    category: "performance",
    title: "Cache under eviction pressure",
    baseSeverity: "high",
    question:
      "Are dirty or tracked bytes near their eviction triggers, and are application threads being forced to perform eviction themselves? Application-thread eviction means user operations are paying to free memory, which shows up as unexplained latency.",
    evidence:
      "Dirty and tracked bytes against their thresholds, the application-threads-evicting counter, and pages read into cache.",
    reference: "MongoDB docs: WiredTiger cache and eviction",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.COLLSCAN_QUERIES",
    category: "performance",
    title: "Collection scans on large collections",
    baseSeverity: "high",
    question:
      "Which slow operations report a COLLSCAN plan summary, on collections large enough for it to matter? This is the single most common MongoDB performance bug: invisible while the collection is small, and an outage once it is not.",
    evidence:
      "The collection, the operation shape, its duration, documents examined versus returned, and the collection's document count.",
    reference: "MongoDB docs: Analyze Query Performance · Database Profiler",
    appliesToTechnologies: ["mongodb"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.REPLICATION_LAG",
    category: "performance",
    title: "Secondary lagging",
    baseSeverity: "high",
    question:
      "What is the worst member lag in seconds, and how does it compare to the oplog window? Lag inside the window is a performance problem; lag approaching the window is an impending full resync.",
    evidence:
      "Per-member lag, the oplog window for comparison, and whether the lag is growing.",
    reference: "MongoDB docs: Replica Set Data Synchronization",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.WRITE_CONCERN_UNSAFE",
    category: "performance",
    title: "Default write concern can lose acknowledged writes",
    baseSeverity: "high",
    question:
      "What is the default write concern? With w:1 a write is acknowledged once the primary has it, so an election immediately afterwards can roll it back. Report whether journaling is enabled too.",
    evidence:
      "The default write concern, the journal setting, and any per-collection or driver-level override you can see.",
    reference: "MongoDB docs: Write Concern · Rollbacks During Replica Set Failover",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.DISK_RUNWAY",
    category: "performance",
    title: "Data volume running out of space",
    baseSeverity: "critical",
    question:
      "What fraction of the dbPath PVC is used, and how many days of headroom remain at the observed growth rate? Fail above 85% used or under 14 days of runway.",
    evidence: "Used percentage, capacity, growth per day, and days remaining.",
    reference: "kube-prometheus KubePersistentVolumeFillingUp",
    appliesToTechnologies: ["mongodb"],
    requires: "prometheus",
  },
  {
    id: "MONGO.LONG_RUNNING_OP",
    category: "performance",
    title: "Long-running operation in progress",
    baseSeverity: "high",
    question:
      "Is any operation running for longer than a few minutes? Report what it is, what it is waiting on, and whether it holds a lock — a long operation under a global lock stalls everything behind it.",
    evidence:
      "The operation's age, namespace, plan summary, and lock state.",
    reference: "MongoDB docs: currentOp · Terminate Running Operations",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.CONNECTIONS_SATURATED",
    category: "performance",
    title: "Connection headroom nearly exhausted",
    baseSeverity: "high",
    question:
      "What are current connections against available? Fail above 85% used. Report the churn rate too — a driver opening a connection per request exhausts the pool without ever appearing busy.",
    evidence:
      "Current and available connections, the percentage, and the connection creation rate.",
    reference: "MongoDB docs: Connection Pool Overview · serverStatus connections",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.ELECTION_CHURN",
    category: "performance",
    title: "Frequent replica set elections",
    baseSeverity: "high",
    question:
      "How many elections occurred in the observed window? Repeated elections mean a member is flapping — usually resource starvation or network trouble — and every election is a brief write outage.",
    evidence:
      "The election count and timestamps, which members were involved, and what the logs give as the trigger.",
    reference: "MongoDB docs: Replica Set Elections",
    appliesToTechnologies: ["mongodb"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "MONGO.NO_QUERY_VISIBILITY",
    category: "performance",
    title: "Slow queries are not being recorded",
    baseSeverity: "medium",
    question:
      "Is the slow-operation threshold set to something useful, or is the profiler off entirely with a threshold high enough to hide real problems? Without either, no query evidence exists and that absence is the finding.",
    evidence:
      "The profiling level, the slow-operation threshold, and whether any slow operations appear in the log window.",
    reference: "MongoDB docs: Database Profiler · slowOpThresholdMs",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.UNUSED_INDEXES",
    category: "performance",
    title: "Unused indexes carrying write cost",
    baseSeverity: "low",
    question:
      "Which indexes have had no accesses since statistics were last reset, given a meaningful uptime? Every one costs write throughput and space. Exclude the _id index and anything younger than the statistics window.",
    evidence:
      "Index name, collection, size, access count, and how long statistics have been accumulating.",
    reference: "MongoDB docs: $indexStats",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.STORAGE_FRAGMENTED",
    category: "performance",
    title: "Storage size far exceeds data size",
    baseSeverity: "low",
    question:
      "How large is the gap between allocated storage size and logical data size? A wide gap is reclaimable fragmentation, typically after large deletions — worth knowing before buying a larger volume.",
    evidence:
      "Data size, storage size, the ratio, and the collections contributing most to the gap.",
    reference: "MongoDB docs: compact · dbStats",
    appliesToTechnologies: ["mongodb"],
    requires: "engine-sql",
  },
  {
    id: "MONGO.LOG_ERROR_EVENTS",
    category: "performance",
    title: "Errors or storage-engine faults in the logs",
    baseSeverity: "high",
    question:
      "Do the logs contain WiredTiger errors, assertion failures, 'not primary' storms, connection floods, or OOM kills? State the window examined.",
    evidence: "The matching lines with timestamps and frequency, and the window length.",
    reference: "MongoDB docs: Log Messages",
    appliesToTechnologies: ["mongodb"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
];
