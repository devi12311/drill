import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * RabbitMQ.
 *
 * This profile carries two coverage limits that are real in THIS cluster and that the
 * playbook states out loud rather than working around:
 *
 * 1. **There is no Prometheus exporter.** The broker's `rabbitmq_prometheus` plugin is
 *    not exposed (no `:15692`, no ServiceMonitor), so nothing about RabbitMQ is
 *    historical. Every number is point-in-time, which makes "is this queue draining or
 *    growing?" — the question that actually matters about a queue — unanswerable from
 *    metrics alone. The checks are written so that the honest answer is a skip rather
 *    than a guess dressed as a trend.
 * 2. **The management-API toolset is configured for ONE broker.** Namespaces here run
 *    several (`rabbitmq`, `rabbitmq-request`, `rabbitmq-database`), and the ones not
 *    configured are unreachable through the toolset. Assessing the wrong broker with
 *    the right API is worse than admitting the gap, so the method says to verify the
 *    endpoint identity before trusting anything it returns.
 */

export const RABBITMQ_PLAYBOOK: Playbook = {
  technology: "rabbitmq",
  framing:
    "A broker is healthy when messages leave as fast as they arrive, and everything that matters follows from that. The failures worth catching are: a queue growing with no consumer attached (nobody is listening, and nothing will tell you); a memory or disk alarm putting publishers into flow control, which looks to the application like a hung request rather than an error; and an unbounded queue with no dead-letter path, which converts one stuck consumer into an outage. Note before you start: this deployment exposes no RabbitMQ metrics, so you have point-in-time state only — say so rather than inferring a trend you cannot see.",
  dataSources: [
    "Management API: use the RabbitMQ toolset for cluster status, node info, queue and exchange details, and memory and disk usage. IMPORTANT: the toolset is configured for a single broker, while this namespace may run several — verify that the endpoint it talks to is actually {{name}} in {{namespace}} (compare node names and the queue set) before trusting the numbers. If it is a different broker, every check here belongs in \"skipped\" with that reason.",
    "Metrics: there is NO RabbitMQ exporter in this cluster — no `rabbitmq_*` series exist. Container and PVC series (`container_memory_working_set_bytes`, `kubelet_volume_stats_*`) cover the pod, and that is all. Do not report queue depths or rates as if they came from Prometheus.",
    "Logs: the pod logs for {{name}} in namespace {{namespace}}, and Loki for a longer window. With no metrics history, the logs are the ONLY historical evidence available here — alarms, partitions and connection churn all leave traces there, and that makes the log window the closest thing to a trend you have.",
    "Kubernetes: the workload {{name}} in {{namespace}}, its pods, its PVC, and its resource limits. The memory watermark question below is answered against the container limit.",
    "Node: the node each pod is scheduled on and its allocatable memory, because RabbitMQ's default memory watermark is a fraction of the HOST's memory and is therefore wrong wherever a container limit is lower.",
  ],
  method: [
    "Confirm identity first: which broker is the management API actually talking to? Compare its node names and virtual hosts against this workload. If they do not match, stop and record every check as unjudgeable — a confident assessment of the wrong broker is the worst outcome available here.",
    "Check the alarms before anything else: is a memory or disk alarm currently active? An alarm blocks publishers via flow control, which surfaces in applications as hanging requests rather than as errors, so it is both severe and easily misattributed.",
    "Compare the memory watermark against the container limit. The default watermark is a fraction of the host's memory; under a lower cgroup limit the kernel reaches its limit before RabbitMQ reaches its watermark, so the broker is OOMKilled instead of applying back-pressure — the protective mechanism never engages.",
    "Check the disk free limit against the volume for the same reason, and note the PVC's actual free space.",
    "Enumerate queues and look for the shape that matters: depth, consumer count, and unacked messages. A queue with a meaningful depth and ZERO consumers is the highest-value finding in this profile — nobody is listening, and no alarm exists for it.",
    "For queues with consumers, look at unacked counts and redelivery: high unacked means consumers take work and do not finish it; high redelivery means they take it, fail, and it comes back round.",
    "Check queue configuration for the failure modes: queues with no max-length and no dead-letter exchange are unbounded, so one stuck consumer fills memory until the alarm fires. Note durability too — a durable queue holding transient messages is not actually safe.",
    "Check the cluster: node states, the partition-handling strategy, and whether any partition has occurred. Then check queue types — classic mirrored queues are deprecated and lose data on failover in ways quorum queues do not.",
    "Check the Erlang runtime's ceilings: file descriptors, sockets and Erlang processes against their limits. A file-descriptor ceiling is a hard outage that arrives without warning, and it is invisible from Kubernetes.",
    "Check connection and channel churn from the logs: a client opening a connection per message is the classic RabbitMQ antipattern, and with no metrics the log is where it shows up.",
    "If you need a rate rather than a level, take a second sample — but note that repeating an identical tool call is refused, so vary the call (a different queue subset, for instance). If you cannot get two samples, report the level and say explicitly that no trend was measurable.",
  ],
  observations: [
    { key: "identity.api_node", source: "engine", unit: "", how: "node name the management API reports — must match this workload" },
    { key: "identity.matches_target", source: "engine", unit: "", how: "true when the API endpoint is this broker and not a sibling" },
    { key: "version.server", source: "engine", unit: "", how: "RabbitMQ and Erlang versions" },
    { key: "cluster.node_count", source: "engine", unit: "count", how: "nodes in the cluster" },
    { key: "cluster.nodes_running", source: "engine", unit: "count", how: "nodes currently running" },
    { key: "cluster.partition_handling", source: "engine", unit: "", how: "cluster_partition_handling strategy" },
    { key: "cluster.partitions_present", source: "engine", unit: "count", how: "partitions currently reported" },
    { key: "alarms.memory_active", source: "engine", unit: "", how: "whether a memory alarm is currently blocking publishers" },
    { key: "alarms.disk_active", source: "engine", unit: "", how: "whether a disk alarm is currently blocking publishers" },
    { key: "memory.watermark_setting", source: "engine", unit: "", how: "vm_memory_high_watermark as configured, absolute or relative" },
    { key: "memory.watermark_bytes", source: "engine", unit: "bytes", how: "the watermark resolved to bytes" },
    { key: "memory.used_bytes", source: "engine", unit: "bytes", how: "broker memory currently in use" },
    { key: "disk.free_limit_bytes", source: "engine", unit: "bytes", how: "disk_free_limit in effect" },
    { key: "disk.free_bytes", source: "engine", unit: "bytes", how: "free space the broker reports" },
    { key: "disk.pvc_used_pct", source: "metrics", unit: "%", how: "used fraction of the PVC, from container metrics" },
    { key: "pod.memory_limit_bytes", source: "manifest", unit: "bytes", how: "container memory limit — what the watermark is judged against" },
    { key: "pod.memory_working_set_bytes", source: "metrics", unit: "bytes", how: "current working set of the pod" },
    { key: "node.name", source: "node", unit: "", how: "node this pod is scheduled on" },
    { key: "node.allocatable_memory_bytes", source: "node", unit: "bytes", how: "node allocatable memory — what RabbitMQ's default watermark is derived from" },
    { key: "queues.total", source: "engine", unit: "count", how: "queues across all virtual hosts" },
    { key: "queues.total_messages", source: "engine", unit: "count", how: "messages held across all queues" },
    { key: "queues.deepest_name", source: "engine", unit: "", how: "the queue holding the most messages" },
    { key: "queues.deepest_depth", source: "engine", unit: "count", how: "its depth" },
    { key: "queues.without_consumers", source: "engine", unit: "count", how: "non-empty queues with zero consumers — the highest-value signal here" },
    { key: "queues.worst_orphan_name", source: "engine", unit: "", how: "the deepest queue that has no consumer" },
    { key: "queues.total_unacked", source: "engine", unit: "count", how: "unacknowledged messages across queues" },
    { key: "queues.unbounded_count", source: "engine", unit: "count", how: "queues with neither max-length nor a dead-letter exchange" },
    { key: "queues.classic_mirrored_count", source: "engine", unit: "count", how: "classic mirrored queues still in use (deprecated)" },
    { key: "queues.quorum_count", source: "engine", unit: "count", how: "quorum queues in use" },
    { key: "queues.non_durable_count", source: "engine", unit: "count", how: "non-durable queues, which do not survive a restart" },
    { key: "runtime.fd_used", source: "engine", unit: "count", how: "file descriptors in use" },
    { key: "runtime.fd_limit", source: "engine", unit: "count", how: "file descriptor ceiling — a hard outage when reached" },
    { key: "runtime.sockets_used", source: "engine", unit: "count", how: "sockets in use" },
    { key: "runtime.erlang_processes_used", source: "engine", unit: "count", how: "Erlang processes in use against the limit" },
    { key: "connections.total", source: "engine", unit: "count", how: "open connections" },
    { key: "connections.in_flow", source: "engine", unit: "count", how: "connections in flow-control state" },
    { key: "channels.total", source: "engine", unit: "count", how: "open channels" },
    { key: "logs.alarm_events", source: "logs", unit: "count", how: "memory or disk alarm messages in the window examined" },
    { key: "logs.connection_churn_events", source: "logs", unit: "count", how: "connection open/close pairs suggesting per-request connections" },
    { key: "logs.window_hours", source: "logs", unit: "hours", how: "how far back the log window actually reaches — the only history available here" },
  ],
};

export const RABBITMQ_CHECKS: readonly MonitorCheck[] = [
  {
    id: "RABBIT.ALARM_ACTIVE",
    category: "performance",
    title: "Memory or disk alarm blocking publishers",
    baseSeverity: "critical",
    question:
      "Is a memory or disk alarm currently active? An active alarm blocks publishers through flow control, which applications experience as hanging requests rather than as errors — so it is severe and routinely misattributed to the application.",
    evidence:
      "Which alarm, on which node, the triggering value against its limit, and how long the logs show it active.",
    reference: "RabbitMQ docs: Memory and Disk Alarms · Flow Control",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.QUEUE_WITHOUT_CONSUMER",
    category: "performance",
    title: "Non-empty queue with no consumers",
    baseSeverity: "critical",
    question:
      "Are there queues holding messages with zero consumers attached? Nobody is processing that work, nothing in RabbitMQ alarms on it, and the queue grows until it triggers a memory alarm that then blocks unrelated publishers.",
    evidence:
      "The queue name and virtual host, its depth, consumer count, and how old the oldest message is if obtainable.",
    reference: "RabbitMQ docs: Queues — consumers and consumer utilisation",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "RABBIT.MEMORY_WATERMARK_VS_LIMIT",
    category: "performance",
    title: "Memory watermark above the container limit",
    baseSeverity: "critical",
    question:
      "Resolve vm_memory_high_watermark to bytes and compare it to the container memory limit. The default is a fraction of the HOST's memory, so under a lower cgroup limit the kernel kills the pod before RabbitMQ ever applies back-pressure — the protection never engages.",
    evidence:
      "The watermark setting and its resolved value, the container limit, the node's memory, and the current usage.",
    reference: "RabbitMQ docs: Memory Alarms — vm_memory_high_watermark",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.CLUSTER_PARTITION",
    category: "performance",
    title: "Cluster partition present or unhandled",
    baseSeverity: "critical",
    question:
      "Are any partitions currently reported, and what is cluster_partition_handling set to? A partition under `ignore` leaves two halves each believing they are authoritative, which is a data-divergence problem rather than an availability one.",
    evidence:
      "Partitions reported, the handling strategy, node states, and any partition events in the logs.",
    reference: "RabbitMQ docs: Clustering and Network Partitions",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.FD_CEILING",
    category: "performance",
    title: "File descriptor or socket ceiling approaching",
    baseSeverity: "high",
    question:
      "What are file descriptors and sockets in use against their limits? Fail above 80%. Reaching the ceiling refuses new connections outright — a hard outage that arrives with no warning and is invisible from Kubernetes.",
    evidence:
      "Used and limit for descriptors and sockets, the percentages, and the Erlang process count against its limit.",
    reference: "RabbitMQ docs: Networking and Runtime Tuning — file handles",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "RABBIT.DISK_LIMIT_VS_VOLUME",
    category: "performance",
    title: "Disk free limit unsafe against the volume",
    baseSeverity: "high",
    question:
      "Compare disk_free_limit against the volume's actual free space and capacity. Set too low the broker has no room to manoeuvre before the disk is genuinely full; set relative to the wrong figure it alarms constantly or never.",
    evidence:
      "The configured limit, free space reported by the broker, PVC capacity and used percentage.",
    reference: "RabbitMQ docs: Disk Alarms — disk_free_limit",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.UNBOUNDED_QUEUE",
    category: "performance",
    title: "Queue with no length limit and no dead-letter path",
    baseSeverity: "high",
    question:
      "Which queues have neither a max-length (or max-length-bytes) nor a dead-letter exchange? Such a queue grows without bound, so a single stuck consumer becomes a broker-wide memory alarm affecting every other publisher.",
    evidence:
      "The queue names, their current depths, and the policies applied to them.",
    reference: "RabbitMQ docs: Queue Length Limit · Dead Letter Exchanges",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.CLASSIC_MIRRORED_QUEUES",
    category: "performance",
    title: "Deprecated classic mirrored queues in use",
    baseSeverity: "high",
    question:
      "Are classic mirrored queues still in use? They are deprecated and their failover can lose confirmed messages in ways quorum queues do not. Report how many, and whether a policy is still creating them.",
    evidence:
      "Mirrored queue count and names, the policies applying mirroring, the quorum queue count for comparison, and the broker version.",
    reference: "RabbitMQ docs: Classic Queue Mirroring (deprecated) · Quorum Queues",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.UNACKED_BACKLOG",
    category: "performance",
    title: "Large unacknowledged backlog",
    baseSeverity: "high",
    question:
      "How many messages are unacknowledged across queues, and is any single queue's unacked count a large share of its depth? Consumers are taking work and not completing it — usually a consumer error path, a missing ack, or a prefetch set far too high.",
    evidence:
      "Total and per-queue unacked counts against depth, the consumer counts, and prefetch settings if visible.",
    reference: "RabbitMQ docs: Consumer Acknowledgements and Publisher Confirms",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "RABBIT.PUBLISHERS_IN_FLOW",
    category: "performance",
    title: "Publishers in flow control",
    baseSeverity: "high",
    question:
      "Are any connections in flow-control state? Flow control means the broker is deliberately slowing publishers because it cannot keep up — the application sees latency with no error, which is why it is usually diagnosed as a client problem.",
    evidence:
      "Connections in flow, the total connection count, and which alarm or resource is driving it.",
    reference: "RabbitMQ docs: Flow Control",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "RABBIT.NON_DURABLE_QUEUES",
    category: "performance",
    title: "Non-durable queues holding real work",
    baseSeverity: "medium",
    question:
      "Which queues are not durable, and do any hold meaningful depth? A non-durable queue and its messages vanish on broker restart, so a routine pod eviction is silent data loss. Note the durability triple: a durable queue, persistent messages and publisher confirms are all required — any one alone is not enough.",
    evidence:
      "Non-durable queue names and depths, and whether messages are published as persistent where determinable.",
    reference: "RabbitMQ docs: Queue Durability · Publisher Confirms",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
  },
  {
    id: "RABBIT.CONNECTION_CHURN",
    category: "performance",
    title: "Connection or channel churn",
    baseSeverity: "medium",
    question:
      "Do the logs show connections repeatedly opened and closed? Opening a connection per message or per request is the classic RabbitMQ antipattern: each one is a TCP handshake plus an AMQP negotiation, and it exhausts file descriptors long before it exhausts throughput.",
    evidence:
      "Open/close event counts over the window, the current connection and channel counts, and the client names involved.",
    reference: "RabbitMQ docs: Connections — connection lifecycle and churn",
    appliesToTechnologies: ["rabbitmq"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "RABBIT.QUEUE_DEPTH_HIGH",
    category: "performance",
    title: "Queue depth high",
    baseSeverity: "medium",
    question:
      "What is the deepest queue, and is its depth reasonable for its purpose? Because this deployment exposes no RabbitMQ metrics, state plainly whether you could measure a trend or only a level — a large but draining queue is healthy, and without two samples you cannot tell the difference.",
    evidence:
      "The queue, its depth, consumer count, and whether a second sample was obtained; say so explicitly when it was not.",
    reference: "RabbitMQ docs: Queues — monitoring queue length",
    appliesToTechnologies: ["rabbitmq"],
    requires: "queue-api",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "RABBIT.NO_METRICS_HISTORY",
    category: "performance",
    title: "No metrics history for this broker",
    baseSeverity: "medium",
    question:
      "Is any RabbitMQ metric series available in Prometheus for this workload? Without the rabbitmq_prometheus plugin exposed and scraped, every queue figure is point-in-time only: rates, trends and 'was it worse last night' are all unanswerable, and alerting on queue growth is impossible. The absence of instrumentation is the finding.",
    evidence:
      "Which rabbitmq_* series were searched for and not found, and what is consequently unmeasurable.",
    reference: "RabbitMQ docs: Prometheus Monitoring — rabbitmq_prometheus plugin",
    appliesToTechnologies: ["rabbitmq"],
  },
  {
    id: "RABBIT.LOG_ERROR_EVENTS",
    category: "performance",
    title: "Alarms, partitions or crashes in the logs",
    baseSeverity: "high",
    question:
      "Do the logs contain memory or disk alarm messages, partition events, channel or connection errors, or Erlang crash reports? With no metrics available, the log window is the only history this broker has — state how far back you read.",
    evidence: "The matching lines with timestamps and frequency, and the window length.",
    reference: "RabbitMQ docs: Logging",
    appliesToTechnologies: ["rabbitmq"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
];
