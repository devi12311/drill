import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * THE CLUSTER ITSELF — the only profile whose subject is not software running
 * inside a workload.
 *
 * Research and citation trail: `docs/KUBERNETES_PLAYBOOK_INPUT.md`. Read it before
 * editing any threshold here; every number below is traceable to a source there,
 * and the checks that were considered and deliberately dropped are listed there too
 * so they do not get re-added as oversights.
 *
 * Two conventions specific to this profile:
 *
 * 1. **`scope` carries the address.** Every other profile's findings are about one
 *    workload, with `scope` distinguishing containers. Here `scope` holds the node,
 *    namespace, component or object a finding is about, so one cluster target still
 *    accumulates separate per-node history through the existing fingerprint. The
 *    prompt says so explicitly (lib/monitoring/assess.ts).
 * 2. **`node` means node-scoped, even via PromQL.** Node capacity, pressure, kernel
 *    limits, steal and filesystems are tagged `node` although they are fetched with
 *    PromQL against node-exporter, while cluster- and component-level series are
 *    tagged `metrics`. That split makes `sourcesUsed` say something worth knowing —
 *    "it reached node-exporter" is a different fact from "it reached Prometheus" —
 *    and it needed a decision because both come down the same wire.
 *
 * The check list is the longest of any profile (35). That is not scope creep: a
 * cluster genuinely has more independent failure domains than a database, and the
 * comparison is not with PostgreSQL's 25 engine checks alone but with those plus the
 * kind-generic checks a workload run also asks, which lands in the same range.
 * `{{namespace}}` and `{{name}}` are deliberately absent from `dataSources` — for a
 * cluster target they would render the sentinel strings and mean nothing.
 */

export const KUBERNETES_PLAYBOOK: Playbook = {
  technology: "kubernetes",
  framing:
    "A Kubernetes cluster almost never dies of high CPU. It dies of etcd disk latency, which makes every component above it look broken at once; of a resource-request model that has drifted from reality, so the scheduler either cannot place work at all or packs it until neighbours throttle and evict each other; of one shared dependency that every pod needs and nobody monitors — DNS, an admission webhook, the CNI dataplane; and of node saturation Kubernetes does not model, because it schedules on CPU and memory requests and is blind to disk I/O, conntrack, steal time and kernel limits. Investigate downward from the control plane, since everything above inherits its latency, then outward to nodes, scheduling and the shared services. Before any of that, establish what can actually be measured here: a cluster whose etcd and scheduler scrape targets are down cannot be assessed, and saying so is the finding rather than a caveat.",
  dataSources: [
    "Metrics: PromQL against the kube-prometheus-stack Prometheus in the observability namespace, via the prometheus toolset. Expect series from the apiserver, etcd, the scheduler, the controller-manager, kubelet and cAdvisor, node-exporter, kube-state-metrics and CoreDNS — but verify each with `up` by job before using it. Several of these scrape targets fail silently in real clusters, and a missing target is not the same as a healthy one.",
    "Kubernetes API: the kubernetes toolset, with cluster-wide read-only access. Nodes and their conditions, capacity and allocatable; pods across all namespaces with their phases, QoS classes and resource requests; events cluster-wide sorted by time; Deployments, StatefulSets and DaemonSets; PodDisruptionBudgets; ResourceQuotas and LimitRanges; HorizontalPodAutoscalers; PriorityClasses; ValidatingWebhookConfigurations and MutatingWebhookConfigurations; StorageClasses, PersistentVolumes and PersistentVolumeClaims; and `kubectl version` for the server and node versions.",
    "Control-plane logs: on this cluster the apiserver, etcd, scheduler and controller-manager run as static pods in kube-system, so their logs ARE pod logs and are readable through the kubernetes logs toolset. The node's systemd journal is NOT reachable — there is no node shell, only a shell inside the agent's own pod — so kubelet and containerd faults must be judged from metrics and events, and you must say so rather than implying you read their logs.",
    "Cluster-service logs: Loki through the Grafana datasource proxy, for CoreDNS, Calico and other cluster components over a longer window than pod logs retain. Available labels are app, component, container, filename, job, level, namespace, node_name, pod and stream — there is no service label, so select by namespace and pod prefix. Loki holds pod logs only.",
    "Node facts: node-exporter series for CPU steal, load and PSI pressure, disk utilisation and latency, filesystem and inode fill, conntrack occupancy, file descriptors and network drops — plus the Node objects' own capacity, allocatable, labels, taints and conditions. `kubectl top` needs metrics-server, whose presence is not guaranteed here; check before relying on it, and fall back to cAdvisor series.",
    "Cluster conventions: the DNS domain is k8s-clickflare, not cluster.local, so any fully-qualified name in a query must use it. The CNI is Calico. Node hardware is deliberately mixed — bare metal alongside Hetzner Cloud instances — which makes CPU steal and node heterogeneity real concerns here rather than textbook ones.",
    "Everything available to you is read-only. Report what you measured and what should change; never attempt a write, a defragmentation, a drain or a restart.",
  ],
  method: [
    "Establish what is measurable, before measuring anything. Query `up` by job for the apiserver, etcd, scheduler, controller-manager, kubelet, node-exporter, kube-state-metrics and CoreDNS, check whether metrics-server exists, and find out how far back Prometheus actually retains data. Record every missing target. Any check that depends on one you could not reach goes in `skipped` with that reason — never treat missing data as a healthy reading.",
    "Establish the cluster's shape, because it is the denominator for every threshold below: server version, node count and roles, the spread of kubelet versions, how many distinct node classes there are by CPU, memory and disk, total pod count, and how many pods are running per node against the per-node cap. Fetch these before judging anything else.",
    "Go to etcd first, and treat it as the root of the tree. Measure WAL fsync p99 against 10 ms and backend commit p99 against 25 ms, peer round-trip time, leader changes over the window, whether every member sees a leader, database size against the backend quota, the gap between total and in-use size (which is fragmentation awaiting a defragmentation), and the member count. If fsync is slow, say so first and describe the apiserver and controller symptoms below as consequences of it rather than as separate problems.",
    "Then the apiserver. Measure request p99 separately for mutating calls, single-object reads and LISTs, against the 1 s objective for the first two; the 5xx rate; the rate of 429 responses and of API Priority and Fairness rejections and queue waits; and peak in-flight requests against the configured ceilings. Identify which client and which resource drive the most expensive LISTs, and how many stored objects those resources have. Name the client wherever the series carries one.",
    "Examine admission webhooks explicitly, because this is the cheapest catastrophic finding available. List every validating and mutating configuration with its failurePolicy, timeoutSeconds, rules and any namespace selector, and measure each one's p99 latency and error rate. A fail-closed webhook that is slow, erroring, or not excluding kube-system is an outage that will appear at the next pod restart rather than now.",
    "Then the controllers and the scheduler. Measure workqueue depth, queue duration and retry rate by queue name, leader-election flapping, pending pods by scheduler queue, scheduling attempt p99, and pod startup p99 against the 5 s objective. For anything unschedulable, read the actual FailedScheduling event text — the reason is in there, and inferring it instead is how you get a plausible wrong answer.",
    "Measure capacity in both directions, because the two failures look nothing alike. First requests against allocatable, per node and clusterwide: this is whether anything can still be scheduled, and memory matters more than CPU because it cannot be compressed. Second actual usage against requests: this is whether the request numbers mean anything at all. Then compute whether every current request could still be placed if the largest node were lost, and count the pods that declare no requests whatsoever.",
    "Measure the node saturation Kubernetes cannot see and therefore never schedules around: disk utilisation and latency on the volumes backing etcd, containerd and kubelet — check the mountpoints rather than assuming the usual layout, since a shared disk lets one workload starve the control plane — filesystem and inode fill, CPU steal, load and PSI pressure, conntrack occupancy against its limit, file descriptors, and inotify watches.",
    "Check node health over the window, not just now: NotReady transitions, MemoryPressure, DiskPressure and PIDPressure conditions, PLEG relist p99 against 3 s, and the container-runtime operation error rate. State plainly that the kubelet's own logs were not available to you.",
    "Measure what the workloads are collectively experiencing, since that is the cluster's output: the clusterwide CFS throttled-period ratio, OOMKills, evictions, restarts and pods in CrashLoopBackOff. For each, name the namespaces and workloads that dominate the number and their share of it. An aggregate with no culprit is not actionable.",
    "Examine DNS, which every other measurement in the cluster silently depends on. Measure CoreDNS request p99, the SERVFAIL and NXDOMAIN rates, the cache hit ratio and upstream forward health and latency. Then judge its capacity: replica count and placement against cluster size and query rate, whether all replicas sit on one node, whether NodeLocal DNSCache exists, and whether the default ndots setting is amplifying every external lookup into several failed ones.",
    "Examine the network dataplane. Measure kube-proxy rule-sync duration and how stale the last sync is, judged against the number of Services and endpoints and the proxy mode in use. Measure the Calico dataplane's apply time and error counters, the free address count in each node's IPAM block — exhaustion presents as pods stuck ContainerCreating, not as a network error — and whether MTU is consistent across nodes.",
    "Examine storage: PersistentVolumeClaim space and inode utilisation with the worst offenders named, claims stuck Pending, volume attach and detach latency, and multi-attach or mount failures in events.",
    "Assess whether the cluster can survive losing a node on purpose, which is what every upgrade requires. Find cluster-critical components running a single replica or with every replica on one node; PodDisruptionBudgets that permit zero disruptions and therefore block drains indefinitely; multi-replica workloads with no topology spread or anti-affinity; missing or absent priority classes, which leaves eviction order arbitrary and preemption unpredictable; namespaces sitting at their quota; and HorizontalPodAutoscalers pinned at maximum or unable to read their metrics.",
    "Assess decay, which is never urgent and always compounding: whether any kubelet is outside the supported version skew or the cluster is past upstream support, how many terminated and evicted pods were never garbage collected, the cluster event rate, and which resources have object counts large enough to matter to etcd.",
    "Finally, state what you could not measure and why. On this cluster the node systemd journal is unreachable, so a kubelet or container-runtime fault is visible in metrics and events but not in its own logs; and any scrape target that was down in step 1 leaves a real hole. A run that names its blind spots is worth more than one that reads as complete.",
  ],
  observations: [
    // --- what could be measured at all: the honesty layer, read first on the run page
    { key: "coverage.scrape_targets_down", source: "metrics", unit: "count", how: "expected scrape jobs whose `up` is 0 or absent" },
    { key: "coverage.control_plane_scraped", source: "metrics", unit: "", how: "which of etcd, kube-scheduler and kube-controller-manager returned metrics at all" },
    { key: "coverage.metrics_window_days", source: "metrics", unit: "days", how: "how far back Prometheus actually holds data, tested rather than read from config" },
    // --- shape: the denominators
    { key: "cluster.k8s_version", source: "manifest", unit: "", how: "apiserver server version" },
    { key: "cluster.kubelet_version_spread", source: "manifest", unit: "", how: "distinct kubelet versions across nodes, oldest first" },
    { key: "cluster.node_count", source: "manifest", unit: "count", how: "nodes registered, and how many are schedulable" },
    { key: "cluster.control_plane_nodes", source: "manifest", unit: "count", how: "nodes carrying a control-plane role" },
    { key: "cluster.pod_count", source: "manifest", unit: "count", how: "pods in all namespaces, running and total" },
    { key: "cluster.node_class_count", source: "node", unit: "count", how: "distinct node classes by CPU, memory and disk — heterogeneity in one schedulable pool" },
    // --- etcd
    { key: "etcd.wal_fsync_p99_seconds", source: "metrics", unit: "seconds", how: "p99 of etcd_disk_wal_fsync_duration_seconds over the window; target under 0.01" },
    { key: "etcd.backend_commit_p99_seconds", source: "metrics", unit: "seconds", how: "p99 of etcd_disk_backend_commit_duration_seconds; target under 0.025" },
    { key: "etcd.peer_rtt_p99_seconds", source: "metrics", unit: "seconds", how: "p99 peer round-trip time between members; target under 0.05" },
    { key: "etcd.leader_changes_24h", source: "metrics", unit: "count", how: "increase in etcd_server_leader_changes_seen_total over the last day" },
    { key: "etcd.db_size_bytes", source: "metrics", unit: "bytes", how: "etcd_mvcc_db_total_size_in_bytes, highest member" },
    { key: "etcd.db_quota_bytes", source: "metrics", unit: "bytes", how: "the configured backend quota the size above is heading for" },
    { key: "etcd.db_in_use_ratio", source: "metrics", unit: "%", how: "in-use size as a percentage of total — the rest is fragmentation awaiting defragmentation" },
    { key: "etcd.member_count", source: "manifest", unit: "count", how: "etcd members, and how many can be lost while keeping quorum" },
    // --- apiserver
    { key: "apiserver.read_p99_seconds", source: "metrics", unit: "seconds", how: "p99 duration of single-object read requests; objective 1 s" },
    { key: "apiserver.list_p99_seconds", source: "metrics", unit: "seconds", how: "p99 duration of LIST requests, with the worst resource named" },
    { key: "apiserver.write_p99_seconds", source: "metrics", unit: "seconds", how: "p99 duration of mutating requests; objective 1 s" },
    { key: "apiserver.error_rate_pct", source: "metrics", unit: "%", how: "5xx responses as a percentage of all requests over the window" },
    { key: "apiserver.throttled_per_second", source: "metrics", unit: "count", how: "429 responses plus API Priority and Fairness rejections per second" },
    { key: "apiserver.inflight_peak", source: "metrics", unit: "count", how: "peak concurrent in-flight requests, read and mutating, against the ceilings in effect" },
    { key: "apiserver.top_list_resource", source: "metrics", unit: "", how: "the resource and client generating the most expensive LIST load" },
    { key: "apiserver.storage_objects_max", source: "metrics", unit: "count", how: "highest stored object count for any single resource, naming which resource it is" },
    { key: "apiserver.webhook_worst_p99_seconds", source: "metrics", unit: "seconds", how: "slowest admission webhook p99, named" },
    { key: "apiserver.fail_closed_webhooks", source: "manifest", unit: "count", how: "webhook configurations with failurePolicy Fail that do not exclude kube-system" },
    // --- scheduling and controllers
    { key: "scheduler.pending_pods", source: "metrics", unit: "count", how: "pods in the scheduler's unschedulable and backoff queues" },
    { key: "scheduler.pending_over_15m", source: "manifest", unit: "count", how: "pods Pending for more than fifteen minutes, with the dominant FailedScheduling reason" },
    { key: "scheduler.attempt_p99_seconds", source: "metrics", unit: "seconds", how: "p99 scheduling attempt duration" },
    { key: "pod.startup_p99_seconds", source: "metrics", unit: "seconds", how: "p99 end-to-end pod startup latency; objective 5 s excluding image pull" },
    { key: "controllers.max_workqueue_depth", source: "metrics", unit: "count", how: "deepest controller workqueue over the window, naming the queue — the name is what identifies the lagging controller" },
    // --- capacity, both directions
    { key: "capacity.cpu_requests_pct_allocatable", source: "metrics", unit: "%", how: "sum of CPU requests as a percentage of allocatable, clusterwide" },
    { key: "capacity.memory_requests_pct_allocatable", source: "metrics", unit: "%", how: "sum of memory requests as a percentage of allocatable, clusterwide" },
    { key: "capacity.worst_node_memory_requests_pct", source: "metrics", unit: "%", how: "the same ratio on the most committed single node, named" },
    { key: "capacity.cpu_usage_pct_requests", source: "metrics", unit: "%", how: "actual CPU usage as a percentage of requests — well under 100 is waste, over is a fiction" },
    { key: "capacity.memory_usage_pct_requests", source: "metrics", unit: "%", how: "actual working set as a percentage of memory requests" },
    { key: "capacity.headroom_after_largest_node_loss_pct", source: "metrics", unit: "%", how: "allocatable remaining above total requests if the largest node were lost; negative means workloads would not fit" },
    { key: "capacity.pods_without_requests", source: "manifest", unit: "count", how: "pods declaring no CPU or no memory request at all" },
    { key: "capacity.worst_node_pod_cap_pct", source: "metrics", unit: "%", how: "running pods against the per-node pod cap on the fullest node, named" },
    // --- nodes: what Kubernetes does not schedule around
    { key: "node.worst_cpu_steal_pct", source: "node", unit: "%", how: "highest sustained CPU steal on any node, named — the virtualisation over-subscription signal" },
    { key: "node.worst_disk_utilisation_pct", source: "node", unit: "%", how: "busiest disk on any node, and whether it backs etcd, containerd or kubelet" },
    { key: "node.worst_root_fs_used_pct", source: "node", unit: "%", how: "fullest filesystem on any node, with inode usage if it differs materially" },
    { key: "node.worst_conntrack_used_pct", source: "node", unit: "%", how: "conntrack entries against the limit on the worst node" },
    { key: "node.pressure_conditions", source: "manifest", unit: "count", how: "nodes currently reporting Memory, Disk or PID pressure, named" },
    { key: "node.not_ready_events_24h", source: "metrics", unit: "count", how: "NotReady transitions in the last day, and on which nodes" },
    { key: "kubelet.pleg_relist_p99_seconds", source: "metrics", unit: "seconds", how: "p99 PLEG relist duration; sustained values near 3 s precede NotReady" },
    { key: "kubelet.cri_error_rate_pct", source: "metrics", unit: "%", how: "failing container-runtime operations as a percentage, by operation type" },
    // --- the cluster's output: what workloads experience
    { key: "health.cpu_throttled_pct_cluster", source: "metrics", unit: "%", how: "throttled CFS periods as a fraction of all periods clusterwide, naming the workload contributing most of it" },
    { key: "health.oomkills_24h", source: "metrics", unit: "count", how: "containers terminated OOMKilled in the last day, with the top namespace" },
    { key: "health.evictions_24h", source: "metrics", unit: "count", how: "pods evicted by node pressure in the last day, and from which nodes" },
    { key: "health.restarts_24h", source: "metrics", unit: "count", how: "container restarts clusterwide in the last day" },
    { key: "health.crashloop_pods", source: "manifest", unit: "count", how: "pods currently in CrashLoopBackOff, with the worst namespace" },
    // --- DNS and network
    { key: "dns.p99_seconds", source: "metrics", unit: "seconds", how: "CoreDNS request duration p99" },
    { key: "dns.servfail_rate_pct", source: "metrics", unit: "%", how: "SERVFAIL responses as a percentage of all responses" },
    { key: "dns.nxdomain_rate_pct", source: "metrics", unit: "%", how: "NXDOMAIN as a percentage — high values usually mean search-path amplification, not broken names" },
    { key: "dns.cache_hit_pct", source: "metrics", unit: "%", how: "CoreDNS cache hits as a percentage of lookups" },
    { key: "dns.replicas", source: "manifest", unit: "count", how: "CoreDNS replicas ready, and how many distinct nodes they sit on" },
    { key: "net.kube_proxy_sync_p99_seconds", source: "metrics", unit: "seconds", how: "p99 proxy rule-sync duration, with the proxy mode in use" },
    { key: "net.service_count", source: "manifest", unit: "count", how: "Services and total endpoints — the input that makes rule syncing expensive" },
    { key: "net.cni_dataplane_p99_seconds", source: "metrics", unit: "seconds", how: "Calico dataplane apply time p99; empty when felix metrics are not scraped" },
    { key: "net.node_ip_free_min", source: "metrics", unit: "count", how: "fewest free pod IPs in any node's IPAM block" },
    // --- storage
    { key: "storage.worst_pvc_used_pct", source: "metrics", unit: "%", how: "fullest PersistentVolumeClaim by space, named, with inode usage if worse" },
    { key: "storage.pvcs_pending", source: "manifest", unit: "count", how: "claims stuck Pending, with the reason" },
    { key: "storage.volume_attach_p99_seconds", source: "metrics", unit: "seconds", how: "p99 volume attach or mount duration" },
    // --- surviving a node loss on purpose
    { key: "resilience.single_replica_critical_addons", source: "manifest", unit: "count", how: "cluster-critical components with one replica or all replicas on one node, named" },
    { key: "resilience.pdbs_blocking_drain", source: "manifest", unit: "count", how: "PodDisruptionBudgets currently allowing zero disruptions, named" },
    { key: "resilience.workloads_not_spread", source: "manifest", unit: "count", how: "multi-replica workloads with every pod on a single node" },
    { key: "resilience.namespaces_at_quota", source: "manifest", unit: "count", how: "namespaces at or above a ResourceQuota limit, named" },
    { key: "resilience.hpas_at_max", source: "manifest", unit: "count", how: "HorizontalPodAutoscalers pinned at maxReplicas or unable to read their metrics" },
    // --- decay
    { key: "bloat.terminated_pods", source: "manifest", unit: "count", how: "Succeeded, Failed and Evicted pods still present and never garbage collected" },
    { key: "bloat.events_per_hour", source: "metrics", unit: "count", how: "cluster event creation rate — a flood is both a symptom and etcd load" },
  ],
};

export const KUBERNETES_CHECKS: readonly MonitorCheck[] = [
  {
    id: "K8S.OBSERVABILITY_GAPS",
    category: "performance",
    title: "Cluster cannot be fully observed",
    baseSeverity: "high",
    question:
      "Which expected scrape targets are down or absent — etcd, the scheduler, the controller-manager, kubelet, node-exporter, kube-state-metrics, CoreDNS, metrics-server — and how far back does Prometheus actually retain data? Fail whenever a target needed by the checks below is unreachable, and list which of those checks are therefore unjudgeable. This is not a caveat on the assessment; it is the assessment's most important result, because every other clean answer here is conditional on it.",
    evidence:
      "The `up` value per job, which components returned no series at all, the retention window you measured, and the list of checks left unjudgeable.",
    reference:
      "kube-prometheus-stack control-plane ServiceMonitors · HOLMES_KNOWLEDGE_BASE.md §7.2 (a toolset marked healthy at boot is not a working query)",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.ETCD_FSYNC_SLOW",
    category: "performance",
    title: "etcd disk latency above target",
    baseSeverity: "critical",
    question:
      "Is WAL fsync p99 above 10 ms, or backend commit p99 above 25 ms? etcd is the one component every other one waits on, so this is the single finding that explains apiserver latency, controller timeouts and slow scheduling at the same time. Report peer round-trip time alongside it, since a slow peer link produces the same symptoms for a different reason.",
    evidence:
      "fsync and backend-commit p99 with the window, peer round-trip p99, which member is worst, and the disk that member's data directory sits on.",
    reference: "etcd docs: hardware requirements and tuning — 99th percentile fsync under 10 ms",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "control-plane-metrics",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.ETCD_NO_QUORUM_MARGIN",
    category: "performance",
    title: "etcd cannot survive losing a member",
    baseSeverity: "critical",
    question:
      "How many etcd members are there, and how many can be lost while keeping quorum? A single member has no redundancy and an even count adds none over the odd number below it. Also confirm every member currently sees a leader — a member without one is serving stale reads or nothing.",
    evidence:
      "Member count and health, the tolerated failure count, control-plane node count, and whether any member reports no leader.",
    reference: "etcd docs: FAQ on cluster size and quorum · Kubernetes highly-available topology docs",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.ETCD_LEADER_FLAPPING",
    category: "performance",
    title: "etcd leader elections recurring",
    baseSeverity: "high",
    question:
      "How many leader changes occurred over the window? A healthy cluster has none for weeks. Repeated elections mean members are timing out on each other — usually disk or network, occasionally an overloaded member — and every election is a brief write stall for the whole cluster.",
    evidence:
      "Leader-change count and timestamps, what the etcd pod logs say at those moments, and the fsync and peer-latency figures for the same period.",
    reference: "etcd docs: operations guide — leader election and heartbeat tuning",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "control-plane-metrics",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.ETCD_DB_NEAR_QUOTA",
    category: "performance",
    title: "etcd database approaching its quota or heavily fragmented",
    baseSeverity: "high",
    question:
      "Is the database size above 80% of the backend quota, or is in-use size far below total size? Crossing the quota raises a NOSPACE alarm that makes the whole cluster read-only until a human intervenes, and a large in-use gap means space that only a defragmentation will return.",
    evidence:
      "Total size, in-use size and the quota per member, the ratio between them, and the resources with the largest object counts.",
    reference: "etcd docs: maintenance — space quota, defragmentation and the NOSPACE alarm",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "control-plane-metrics",
  },
  {
    id: "K8S.APISERVER_DEGRADED",
    category: "performance",
    title: "API server latency or error rate above objective",
    baseSeverity: "high",
    question:
      "Measure p99 separately for mutating requests, single-object reads and LISTs, and the 5xx rate. Fail above 1 second for the first two, and name the worst resource and verb in every case. LISTs are judged against their object count rather than a fixed number, so state both.",
    evidence:
      "p99 by verb class with the worst resource named, the 5xx rate and which resources produce it, peak in-flight requests against the configured ceilings, and the etcd latency for the same window so the two are not confused.",
    reference: "Kubernetes scalability SLIs/SLOs: 99th percentile API call latency ≤ 1 s for mutating and single-object read calls",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.APISERVER_THROTTLING",
    category: "performance",
    title: "API requests being rejected or queued",
    baseSeverity: "high",
    question:
      "Are clients receiving 429s, or having requests queued or rejected by API Priority and Fairness? Report the rate, the flow schemas and priority levels involved, and which clients are affected — a controller being throttled is reconciliation silently falling behind, which surfaces later as something else entirely.",
    evidence:
      "429 rate and APF rejection and queue-wait figures by priority level, the clients involved, and in-flight peaks against the ceilings.",
    reference: "Kubernetes docs: API Priority and Fairness — rejected requests and queue depth",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.EXPENSIVE_LIST_LOAD",
    category: "performance",
    title: "Expensive LIST traffic loading the control plane",
    baseSeverity: "medium",
    question:
      "Which client and resource generate the heaviest LIST load, and how many objects does each call return? Full unpaginated LISTs of a large resource bypass the watch cache and read straight through to etcd, so a single badly written controller can dominate control-plane cost. Name the client where the series carries one.",
    evidence:
      "LIST rate and p99 by resource and client, the stored object count for those resources, and the resulting apiserver and etcd load.",
    reference: "Kubernetes docs: API concepts — retrieving large results sets in chunks · watch cache behaviour",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
  },
  {
    id: "K8S.ADMISSION_WEBHOOK_RISK",
    category: "performance",
    title: "Fail-closed admission webhook can take the cluster down",
    baseSeverity: "critical",
    question:
      "Is there a validating or mutating webhook with failurePolicy Fail that is slow, erroring, or does not exclude kube-system from its scope? Such a webhook makes its own availability a precondition for creating pods anywhere, so the failure appears not now but at the next restart — often during an unrelated incident, when it prevents recovery.",
    evidence:
      "Webhook name and configuration, failurePolicy, timeoutSeconds, rules and namespace selector, its measured p99 and error rate, and which service backs it and with how many replicas.",
    reference: "Kubernetes docs: dynamic admission control — failure policy and avoiding deadlock",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.CONTROLLER_QUEUE_BACKLOG",
    category: "performance",
    title: "Controller reconciliation falling behind",
    baseSeverity: "high",
    question:
      "Which controller workqueue is backed up, by depth, queue duration or retry rate, and how far behind is it? A backed-up queue means the cluster's declared state and its actual state have diverged — endpoints not updated, garbage not collected, nodes not being reacted to — while every object still reads as correct.",
    evidence:
      "Queue name with depth, queue and work duration, retry and add rates, plus any leader-election flapping in the same component.",
    reference: "Kubernetes controller-manager workqueue metrics · client-go workqueue instrumentation",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "control-plane-metrics",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.VERSION_SKEW_OR_EOL",
    category: "performance",
    title: "Version skew or unsupported release",
    baseSeverity: "medium",
    question:
      "Is any kubelet more than three minor versions behind the apiserver, ahead of it, or is the cluster itself past upstream support? An unsupported release means unpatched bugs and no upstream help; a skew violation means behaviour nobody tests. Both are cheap to find and expensive to discover during an incident.",
    evidence:
      "Server version, each distinct kubelet version with the nodes on it, and the support status of the release in use.",
    reference: "Kubernetes docs: version skew policy · supported release window",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.PODS_PENDING",
    category: "performance",
    title: "Pods cannot be scheduled",
    baseSeverity: "high",
    question:
      "Which pods have been Pending for more than fifteen minutes, and what does their FailedScheduling event actually say? Read the event text rather than inferring the cause — insufficient CPU, insufficient memory, no matching node, unsatisfied topology constraint, quota exceeded and unbound volume all look identical from the outside and have different fixes.",
    evidence:
      "Pending pods with age and namespace, the verbatim FailedScheduling messages, and the capacity or constraint figure the message points at.",
    reference: "Kubernetes docs: scheduler — pod scheduling failures and events",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.POD_STARTUP_LATENCY",
    category: "performance",
    title: "Pod startup latency above objective",
    baseSeverity: "medium",
    question:
      "What are scheduling attempt p99 and end-to-end pod startup p99, against the 5 second objective for a stateless pod whose image is already present? Slow startup lengthens every rollout and every recovery, so it converts a brief node loss into a long one.",
    evidence:
      "Scheduling attempt and pod startup p99, whether image pulls dominate, and the kubelet pod-worker duration for the same window.",
    reference: "Kubernetes scalability SLIs/SLOs: 99th percentile pod startup latency ≤ 5 s",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "control-plane-metrics",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.MEMORY_OVERCOMMITTED",
    category: "performance",
    title: "Memory requests exceed what nodes can hold",
    baseSeverity: "critical",
    question:
      "What proportion of allocatable memory is already requested, clusterwide and on the worst node? Memory cannot be compressed, so unlike CPU this does not degrade gracefully: it ends in node-pressure eviction and OOMKills, and the pods killed are chosen by QoS class rather than by importance.",
    evidence:
      "Requests against allocatable clusterwide and per node with the worst node named, actual working set for comparison, and any eviction or OOMKill activity already occurring.",
    reference: "Kubernetes docs: node-pressure eviction · QoS classes — memory is a non-compressible resource",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
  },
  {
    id: "K8S.CPU_OVERCOMMITTED",
    category: "performance",
    title: "CPU requests leave no room to schedule",
    baseSeverity: "high",
    question:
      "What proportion of allocatable CPU is requested, clusterwide and per node? Past roughly 90% the scheduler starts refusing work even while the machines look idle, because it places on requests and not on usage. Report both numbers so the gap between them is visible.",
    evidence:
      "CPU requests against allocatable clusterwide and on the most committed nodes, actual usage for the same period, and any pods Pending for insufficient CPU.",
    reference: "Kubernetes docs: managing resources for containers — requests and scheduling",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
  },
  {
    id: "K8S.NO_HEADROOM_FOR_NODE_LOSS",
    category: "performance",
    title: "Cluster cannot absorb the loss of one node",
    baseSeverity: "high",
    question:
      "If the largest node were lost or drained, could every current request still be placed? Answer with the arithmetic, not an impression. Without this headroom every node reboot, upgrade and hardware failure becomes an outage, and a rolling upgrade cannot start at all.",
    evidence:
      "Total requests, total allocatable, allocatable minus the largest node, the resulting margin for CPU and memory separately, and which workloads would fail to fit.",
    reference: "Kubernetes docs: cluster capacity planning · safely drain a node",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
  },
  {
    id: "K8S.REQUESTS_UNSET",
    category: "performance",
    title: "Pods running with no resource requests",
    baseSeverity: "high",
    question:
      "How many pods declare no CPU or no memory request, and which are they? A pod with no request is invisible to the scheduler's arithmetic — it is placed anywhere and then competes for whatever is left — and with no memory request it is BestEffort, so it is the first thing evicted when the node comes under pressure.",
    evidence:
      "Count and list of pods missing CPU or memory requests with their namespaces and QoS classes, and their measured actual usage.",
    reference: "Kubernetes docs: QoS classes · configure default requests with a LimitRange",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.REQUESTS_MISCALIBRATED",
    category: "performance",
    title: "Requests do not reflect measured usage",
    baseSeverity: "medium",
    question:
      "Compare actual usage against requests in both directions. Requests far above usage reserve capacity nobody uses, which is why the cluster cannot schedule; usage above requests means the pod is borrowing capacity it never claimed and will throttle or be evicted when a neighbour claims it. Report the worst offenders in each direction.",
    evidence:
      "Usage-to-request ratios clusterwide and for the worst workloads in both directions, the window and percentile used, and the capacity that would be freed or must be added.",
    reference: "Kubernetes docs: managing resources for containers · Vertical Pod Autoscaler recommender methodology",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.CPU_THROTTLING_WIDESPREAD",
    category: "performance",
    title: "CPU throttling widespread across the cluster",
    baseSeverity: "high",
    question:
      "What fraction of CFS periods are throttled clusterwide, and which workloads account for most of it? Fail above 10% overall or wherever a significant workload is being throttled heavily. Throttling is latency that appears in the application and nowhere in the cluster's own dashboards, which is why it goes unnoticed for months.",
    evidence:
      "Clusterwide throttled ratio, the top workloads by contribution with their own ratios and CPU limits, and the namespaces involved.",
    reference: "cAdvisor CFS throttling metrics · Linux CFS bandwidth control",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.NODE_SATURATED",
    category: "performance",
    title: "Node saturated in a dimension Kubernetes does not schedule on",
    baseSeverity: "high",
    question:
      "Is any node saturated on disk I/O, CPU steal, or PSI pressure? The scheduler models CPU and memory requests only, so these are invisible to it and present as unexplained latency in whichever application noticed first. Check specifically whether the busy disk backs etcd, containerd or kubelet, since that turns one workload's I/O into a control-plane problem.",
    evidence:
      "Per-node disk utilisation and latency with the mountpoints and what they back, CPU steal, load and PSI figures, and the workloads generating the I/O.",
    reference: "Linux pressure stall information · node-exporter disk and CPU metrics · etcd docs on dedicated disks",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "node",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.NODE_KERNEL_LIMITS",
    category: "performance",
    title: "Node approaching a kernel resource limit",
    baseSeverity: "high",
    question:
      "Are conntrack entries, file descriptors, inotify watches or filesystem inodes near their limits on any node? Each fails in a way that looks like something else entirely: a full conntrack table drops packets at random, exhausted inotify watches stop operators and kubelet from noticing changes, and full inodes fail writes on a disk with free space.",
    evidence:
      "Per-node usage against the limit for each dimension, the nodes affected, and the symptoms already visible in events or logs.",
    reference: "kube-proxy conntrack tuning · Linux inotify limits · node-exporter filefd and filesystem metrics",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "node",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.NODE_HETEROGENEITY",
    category: "performance",
    title: "Unlabelled mixed node classes in one schedulable pool",
    baseSeverity: "medium",
    question:
      "Are nodes of materially different CPU, memory or disk class schedulable for the same workloads without labels, taints or affinity separating them? The same pod then performs differently depending on where it lands, and the slowest node sets the pace for anything replicated across them. This cluster has already been hurt by exactly this once.",
    evidence:
      "Node classes with their CPU, memory and disk specifications, the labels and taints present, and any workload with replicas spread across classes together with the performance difference measured between them.",
    reference: "Kubernetes docs: assigning pods to nodes · docs/CLICKHOUSE_PLAYBOOK_INPUT.md §1 (slow Hetzner Cloud nodes were a measured bottleneck)",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.NODE_UNHEALTHY_HISTORY",
    category: "performance",
    title: "Nodes going unhealthy or the kubelet struggling",
    baseSeverity: "high",
    question:
      "Which nodes went NotReady or reported pressure conditions over the window, and is PLEG relist p99 or the container-runtime error rate elevated on any of them? A node flapping NotReady evicts and reschedules everything on it each time, which is far more disruptive than a node that is simply down.",
    evidence:
      "NotReady transitions with timestamps and nodes, current pressure conditions, PLEG relist p99, runtime operation error rates by type, and the events around each transition. Say explicitly that the kubelet's own logs were not reachable.",
    reference: "Kubernetes kubelet PLEG design · node status and conditions",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.EVICTIONS_OR_OOMKILLS",
    category: "performance",
    title: "Pods being evicted or OOMKilled",
    baseSeverity: "high",
    question:
      "How many pods were evicted by node pressure or terminated OOMKilled over the window, and on which nodes and in which namespaces? Both are the cluster taking work away to protect itself, so they are the visible end of the capacity problem rather than a workload's own bug — name the nodes so the two can be told apart.",
    evidence:
      "Eviction and OOMKill counts by node and namespace, the node conditions at those times, and the requests and limits of the pods affected.",
    reference: "Kubernetes docs: node-pressure eviction · kube-state-metrics last_terminated_reason",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.DNS_DEGRADED",
    category: "performance",
    title: "Cluster DNS slow or failing",
    baseSeverity: "critical",
    question:
      "What is CoreDNS request p99, the SERVFAIL rate, the cache hit ratio and upstream forward health? Every service-to-service call in the cluster begins with a lookup, so DNS latency is added to everything and DNS failure is indistinguishable, from an application's point of view, from the dependency being down.",
    evidence:
      "Request p99, SERVFAIL and NXDOMAIN rates, cache hit ratio, forward latency and health-check failures to upstream resolvers, and CoreDNS error lines from logs.",
    reference: "Kubernetes docs: DNS for services and pods · CoreDNS metrics and plugin documentation",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.DNS_CAPACITY",
    category: "performance",
    title: "Cluster DNS has no capacity or resilience margin",
    baseSeverity: "high",
    question:
      "Are CoreDNS replicas sufficient for the cluster's size and query rate, spread across nodes, and is there any node-local caching? Fail when all replicas share a node, when the replica count has not moved with the cluster, or when the default ndots search-path behaviour is turning every external lookup into several failed queries first.",
    evidence:
      "Replica count and readiness, the nodes they run on, query rate per replica, CoreDNS CPU usage against its limit, the NXDOMAIN rate as an amplification signal, and whether NodeLocal DNSCache exists.",
    reference: "Kubernetes docs: DNS autoscaling · NodeLocal DNSCache · pod DNS config and ndots",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.KUBE_PROXY_SYNC_LAG",
    category: "performance",
    title: "Service rules syncing slowly or stale",
    baseSeverity: "medium",
    question:
      "How long does a proxy rule sync take, and how stale is the last one, judged against the number of Services and endpoints and the proxy mode in use? While a sync is pending, traffic goes to endpoints that have moved, which appears to applications as intermittent connection failures during any rollout.",
    evidence:
      "Sync duration p99 and last-sync age per node, Service and endpoint counts, the proxy mode, and the endpoint-slice controller's queue depth.",
    reference: "Kubernetes docs: virtual IPs and service proxies — iptables versus IPVS scaling",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.CNI_DATAPLANE_HEALTH",
    category: "performance",
    title: "Pod network dataplane degraded",
    baseSeverity: "high",
    question:
      "Is the CNI dataplane applying changes promptly and without errors, does every node have free pod IP addresses in its IPAM block, and is MTU consistent across nodes? IP exhaustion presents as pods stuck ContainerCreating rather than as a network error, and an MTU mismatch presents as large transfers failing while pings succeed — the sort of fault that gets blamed on a database for weeks.",
    evidence:
      "Dataplane apply duration and error counters, free addresses per node block, MTU per node, pods stuck in ContainerCreating with their events, and TCP retransmission or drop rates. Say so if the CNI exposes no metrics here.",
    reference: "Calico documentation: felix metrics and IPAM · docs/CLICKHOUSE_PLAYBOOK_INPUT.md §3.8 (replication failures previously attributed to Calico)",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.PVC_NEAR_FULL",
    category: "performance",
    title: "Persistent volume near capacity",
    baseSeverity: "high",
    question:
      "Which PersistentVolumeClaims are near their space or inode capacity, and how fast are they filling? A full volume is not a slowdown — the workload using it stops writing, and for a database that is an outage. Report the growth rate so the time remaining is a number rather than a guess.",
    evidence:
      "Used and available bytes and inodes per claim with the worst named, the growth rate over the window and the projected time to full, and whether the StorageClass allows expansion.",
    reference: "Kubernetes docs: persistent volumes — expanding claims · kubelet volume stats metrics",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.VOLUME_OPS_DEGRADED",
    category: "performance",
    title: "Volume attach or mount operations failing or slow",
    baseSeverity: "medium",
    question:
      "Are volume attach, detach or mount operations slow or failing, are any claims stuck Pending, and are there multi-attach errors? These make a pod's recovery time depend on storage rather than on the pod, so a node failure takes far longer to recover from than the restart itself suggests.",
    evidence:
      "Attach and mount duration p99 and failure counts by operation, pods stuck ContainerCreating on volumes, Pending claims with their reasons, and the relevant events.",
    reference: "Kubernetes docs: storage — volume attach/detach controller · CSI operation metrics",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "K8S.SINGLE_POINT_ADDONS",
    category: "performance",
    title: "Cluster-critical component has no redundancy",
    baseSeverity: "high",
    question:
      "Which cluster-critical components — DNS, ingress, metrics-server, CNI controllers, the monitoring stack, CSI controllers — run a single replica, or run several replicas that all sit on one node? Every workload depends on these, so their availability is a ceiling on the whole cluster's, and co-located replicas provide the appearance of redundancy without any.",
    evidence:
      "Each component with its replica count, readiness and the nodes its pods occupy, plus any anti-affinity or topology-spread rules present or absent.",
    reference: "Kubernetes docs: pod topology spread constraints · well-known cluster addon deployment practice",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.PDB_BLOCKS_DRAIN",
    category: "performance",
    title: "PodDisruptionBudget blocks node maintenance",
    baseSeverity: "high",
    question:
      "Which PodDisruptionBudgets currently allow zero disruptions? A budget in that state blocks a drain indefinitely, so node maintenance, kernel patching and cluster upgrades cannot proceed — and it is usually discovered halfway through the first one. Distinguish a budget that is temporarily at zero because the workload is unhealthy from one whose configuration can never permit a disruption.",
    evidence:
      "Each budget with its selector, minAvailable or maxUnavailable, current healthy and desired counts and disruptionsAllowed, and the replica count of the workload it selects.",
    reference: "Kubernetes docs: disruptions — PodDisruptionBudget and draining nodes",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.NO_TOPOLOGY_SPREAD",
    category: "performance",
    title: "Replicas concentrated on one node",
    baseSeverity: "medium",
    question:
      "Which multi-replica workloads currently have every pod on a single node, and do they declare topology-spread constraints or anti-affinity at all? Replicas that share a node share its failure, so the workload is configured for availability and does not have it — and the arrangement is usually accidental, produced by whichever node had room at the time.",
    evidence:
      "Workloads with replica count, the node distribution of their pods, and the spread or anti-affinity rules present or absent.",
    reference: "Kubernetes docs: pod topology spread constraints · inter-pod anti-affinity",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.PRIORITY_MISCONFIGURED",
    category: "performance",
    title: "Eviction and preemption order left to chance",
    baseSeverity: "medium",
    question:
      "Do workloads carry priority classes that reflect what actually matters, and is preemption churning? With no priorities, the node under pressure chooses what to evict by QoS class alone, so an important BestEffort pod dies before an unimportant Guaranteed one; with badly set priorities, high-priority pods repeatedly evict others and nothing settles.",
    evidence:
      "PriorityClasses defined and which workloads use them, whether system-critical components are protected, and preemption attempt and victim counts over the window.",
    reference: "Kubernetes docs: pod priority and preemption · QoS-based eviction ordering",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
  {
    id: "K8S.HPA_INEFFECTIVE",
    category: "performance",
    title: "Autoscaler pinned at its ceiling or blind",
    baseSeverity: "medium",
    question:
      "Are any HorizontalPodAutoscalers sitting at maxReplicas, or unable to read their metrics? An HPA at its maximum has stopped being an autoscaler and is now a fixed replica count that nobody chose, and one that cannot read metrics has silently stopped scaling at whatever number it last reached.",
    evidence:
      "Each HPA with current, desired, minimum and maximum replicas, how long it has been at the ceiling, its metric targets and current values, and any ScalingActive or AbleToScale condition that is false with its message.",
    reference: "Kubernetes docs: horizontal pod autoscaling — conditions and metric availability",
    appliesTo: ["cluster"],
    appliesToTechnologies: ["kubernetes"],
  },
];
