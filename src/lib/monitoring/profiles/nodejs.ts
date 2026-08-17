import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";

/**
 * Node.js services. The richest sources of the lot — logs, traces and the actual
 * source code — and the only profile where the investigation can end at a line
 * number rather than a metric.
 *
 * The honest limitation, stated in the playbook as well as here: this cluster
 * exposes NO application-level RED metrics. Nothing scrapes request rate, error
 * rate or latency from the services themselves, so the golden signals have to be
 * reconstructed from traces and logs. Traces come from Tempo 1.3, which has no
 * TraceQL and only tag-equality search over a recent window. That makes some
 * questions answerable only approximately, which is a reason to say so in the
 * evidence — never a reason to guess.
 */

export const NODEJS_PLAYBOOK: Playbook = {
  technology: "nodejs",
  framing:
    "A Node.js service fails in ways its container spec cannot show you. It is single-threaded, so CPU saturation appears as latency rather than as high CPU; its heap ceiling is set by a flag rather than by the container limit, so it gets OOMKilled while looking healthy; and its worst outages are usually caused by a dependency it calls badly rather than by its own code. Investigate outward: what users see, then what the runtime is doing, then what it calls, then what the code actually does at the deployed revision.",
  dataSources: [
    "Traces: the Tempo toolset. Search is tag-equality only, over recent traces — no TraceQL, no trace-derived metrics. The service tag matches this workload's name; try `service.name=<NAME>` in upper case first, since these services report it that way. Search by `http.status_code=500` to find failures, then fetch full traces by ID.",
    "Logs: pod logs for {{name}} in namespace {{namespace}}, and Loki for a longer window. Available Loki labels are app, component, container, filename, job, level, namespace, node_name, pod, stream — note there is NO service label, so select by namespace and pod prefix.",
    "Metrics: PromQL, but for infrastructure only — container CPU, throttling, memory working set, restarts, and node state. There is no application RED metric here; do not report request rate, error rate or latency as if it came from Prometheus.",
    "Code: the source repository via the Bitbucket toolset. The repo name matches this workload's name case-insensitively. The deployed revision is the leading alphabetic segment of the container image tag (a tag like `rc-3-2026-07-03-13-30` means branch `rc`); verify that branch exists and say so if you fall back to the default branch.",
    "Kubernetes: the Deployment {{name}} in {{namespace}} — container args and env (heap flags, NODE_ENV, log level), probes, lifecycle hooks, terminationGracePeriodSeconds, resource requests and limits, and any HPA targeting it.",
  ],
  method: [
    "Start with what users see: find failing requests in traces (status 5xx) and error-level lines in logs over the longest window available. Establish the error rate as a proportion of traffic, and say which source and window it came from.",
    "Establish latency from trace durations for the busiest endpoints — not from Prometheus, which has no application timings here.",
    "Check the runtime's shape against the container: CPU limit versus one core (a limit below 1000m on a single-threaded runtime caps throughput and shows up as queueing), CPU throttling ratio, and memory working set against the limit.",
    "Check the heap ceiling explicitly: look for --max-old-space-size or NODE_OPTIONS in args and env, and compare it to the container memory limit. A heap ceiling at or above the limit means the process is killed before V8 ever runs a full GC.",
    "Check crash history: restart counts, last terminated reason, OOMKilled events, and unhandled rejection or uncaught exception lines in the logs.",
    "Check what it calls: from full traces, the outbound spans — database, broker and HTTP calls — their latencies and failure rates, and whether a slow dependency explains the latency you measured in step 2. Look for the same query repeated many times within one trace, which is an N+1.",
    "Check lifecycle correctness in the spec: does the liveness probe touch a dependency (which turns a dependency outage into a restart storm), is there a preStop delay and a SIGTERM handler, and is terminationGracePeriodSeconds longer than the slowest request you measured?",
    "Read the code last, and only where the evidence points: the handler for the failing route at the deployed revision, its error handling, its timeout and retry configuration, and its connection-pool settings.",
    "Finally, name what you could not measure. Absent application metrics are a real gap in this cluster, and a finding that says so is more useful than one that pretends otherwise.",
  ],
  observations: [
    { key: "service.replicas_ready", source: "manifest", unit: "count", how: "ready versus desired replicas" },
    { key: "service.image_tag", source: "manifest", unit: "", how: "the container image tag, which encodes the deployed branch" },
    { key: "service.deployed_ref", source: "code", unit: "", how: "the branch or ref you actually read code from, and whether it was a fallback" },
    { key: "traffic.window_hours", source: "traces", unit: "hours", how: "how far back the trace evidence you used reaches" },
    { key: "traffic.error_traces", source: "traces", unit: "count", how: "traces found with a 5xx status in that window" },
    { key: "traffic.error_rate_pct", source: "traces", unit: "%", how: "failing requests as a percentage of those sampled — state that it is sampled" },
    { key: "latency.p95_ms", source: "traces", unit: "ms", how: "95th percentile duration of the busiest endpoint's traces" },
    { key: "latency.worst_endpoint", source: "traces", unit: "", how: "the route with the worst observed latency" },
    { key: "logs.error_lines", source: "logs", unit: "count", how: "error-level lines in the window examined" },
    { key: "logs.window_hours", source: "logs", unit: "hours", how: "length of the log window actually read" },
    { key: "logs.unhandled_rejections", source: "logs", unit: "count", how: "unhandled promise rejection or uncaught exception occurrences" },
    { key: "logs.top_error_signature", source: "logs", unit: "", how: "the most frequent distinct error message, truncated" },
    { key: "runtime.heap_limit_bytes", source: "manifest", unit: "bytes", how: "--max-old-space-size or NODE_OPTIONS heap ceiling; null when unset" },
    { key: "runtime.node_env", source: "manifest", unit: "", how: "the NODE_ENV value, or empty when unset" },
    { key: "runtime.log_level", source: "manifest", unit: "", how: "the configured log level, if it appears in env or config" },
    { key: "pod.memory_limit_bytes", source: "manifest", unit: "bytes", how: "container memory limit" },
    { key: "pod.cpu_limit_cores", source: "manifest", unit: "cores", how: "container CPU limit, in cores" },
    { key: "pod.memory_working_set_bytes", source: "metrics", unit: "bytes", how: "current working set, peak over the window if available" },
    { key: "pod.memory_growth_bytes_per_day", source: "metrics", unit: "bytes", how: "working-set trend over the longest retained window — the leak signal" },
    { key: "pod.cpu_throttled_pct", source: "metrics", unit: "%", how: "throttled CFS periods as a fraction of all periods" },
    { key: "pod.restarts_24h", source: "metrics", unit: "count", how: "container restarts in the last day" },
    { key: "pod.last_terminated_reason", source: "manifest", unit: "", how: "last terminated reason, e.g. OOMKilled; empty when none" },
    { key: "lifecycle.termination_grace_seconds", source: "manifest", unit: "seconds", how: "terminationGracePeriodSeconds" },
    { key: "lifecycle.has_prestop", source: "manifest", unit: "", how: "whether a preStop hook exists" },
    { key: "lifecycle.liveness_target", source: "manifest", unit: "", how: "what the liveness probe actually hits" },
    { key: "deps.slowest_outbound", source: "traces", unit: "", how: "the slowest outbound dependency seen in traces, and to what" },
    { key: "deps.slowest_outbound_ms", source: "traces", unit: "ms", how: "its observed duration" },
    { key: "deps.db_pool_size", source: "code", unit: "count", how: "configured database connection-pool maximum, from code or env" },
    { key: "deps.repeated_span_max", source: "traces", unit: "count", how: "highest count of the same repeated outbound call within a single trace — an N+1 signal" },
  ],
};

export const NODEJS_CHECKS: readonly MonitorCheck[] = [
  {
    id: "NODE.OOM_RESTARTS",
    category: "performance",
    title: "Service killed for exceeding memory",
    baseSeverity: "critical",
    question:
      "Has any container been terminated with OOMKilled, and is it recurring? Report the restart count and the interval between kills — a service being killed repeatedly is losing in-flight requests every time.",
    evidence:
      "Last terminated reason, restart count and window, memory limit, and the working set before the kill.",
    reference: "kube-state-metrics last_terminated_reason · KRR memory strategy",
    appliesToTechnologies: ["nodejs"],
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.HEAP_ABOVE_LIMIT",
    category: "performance",
    title: "V8 heap ceiling above the container limit",
    baseSeverity: "high",
    question:
      "Compare the configured heap ceiling (--max-old-space-size or NODE_OPTIONS) to the container memory limit. Fail when the ceiling is unset on a limited container, or when it is set at or above the limit — in both cases the kernel kills the process before V8 is forced to collect.",
    evidence:
      "The heap flag and its value, the container memory limit, and the Node major version if determinable.",
    reference: "Node.js CLI docs: --max-old-space-size · V8 heap sizing under cgroups",
    appliesToTechnologies: ["nodejs"],
  },
  {
    id: "NODE.ERROR_RATE",
    category: "performance",
    title: "Elevated request error rate",
    baseSeverity: "high",
    question:
      "What proportion of requests are failing with 5xx, from traces and error-level logs over the longest window available? Fail above 1%. State the window and that trace evidence is sampled.",
    evidence:
      "Failing and total requests sampled, the window, the endpoints involved, and the dominant error signature.",
    reference: "Google SRE Workbook: the four golden signals",
    appliesToTechnologies: ["nodejs"],
    requires: "traces",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.LATENCY_DEGRADED",
    category: "performance",
    title: "User-visible latency degraded",
    baseSeverity: "high",
    question:
      "What is the 95th-percentile duration of the busiest endpoints, from trace durations? Fail above 1 second for an interactive endpoint, and always name which endpoint and how many traces the figure rests on.",
    evidence:
      "The endpoint, its p95 and p99 from traces, the sample size, and the window.",
    reference: "Google SRE Workbook: the four golden signals",
    appliesToTechnologies: ["nodejs"],
    requires: "traces",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.CPU_LIMIT_SUBCORE",
    category: "performance",
    title: "CPU limit below one core",
    baseSeverity: "high",
    question:
      "Is the CPU limit below 1000m? Node.js executes JavaScript on a single thread, so a sub-core limit caps the service's throughput outright and turns load into queueing latency rather than into CPU usage you can see.",
    evidence:
      "The CPU limit and request, the observed throttling ratio, and the measured p95 latency for context.",
    reference: "Node.js docs: the event loop · kube-prometheus CFS throttling metrics",
    appliesToTechnologies: ["nodejs"],
  },
  {
    id: "NODE.CPU_THROTTLED",
    category: "performance",
    title: "Event loop starved by CPU throttling",
    baseSeverity: "high",
    question:
      "What fraction of CFS periods are throttled? Fail above 10%. On a single-threaded runtime, throttling directly delays the event loop, so every concurrent request pays for it.",
    evidence: "The throttled ratio, the CPU limit, and observed CPU usage.",
    reference: "kube-prometheus cAdvisor CFS metrics",
    appliesToTechnologies: ["nodejs"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.MEMORY_LEAK_TREND",
    category: "performance",
    title: "Memory growing without plateau",
    baseSeverity: "high",
    question:
      "Does the working set climb monotonically across the retained window without levelling off, and does it reset only on restart? That pattern is a leak; a plateau below the limit is not.",
    evidence:
      "Working set over time with the growth rate, the memory limit, restart timestamps, and the window length.",
    reference: "Node.js diagnostics: memory leak investigation",
    appliesToTechnologies: ["nodejs"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.UNHANDLED_REJECTIONS",
    category: "performance",
    title: "Unhandled rejections or uncaught exceptions",
    baseSeverity: "high",
    question:
      "Do the logs show unhandled promise rejections or uncaught exceptions? On current Node versions an unhandled rejection terminates the process by default, so these are crashes rather than warnings.",
    evidence:
      "The matching log lines with timestamps and frequency, and whether they coincide with restarts.",
    reference: "Node.js docs: unhandledRejection · process exit behaviour",
    appliesToTechnologies: ["nodejs"],
    requires: "logs",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.LIVENESS_HITS_DEPENDENCY",
    category: "performance",
    title: "Liveness probe depends on a downstream service",
    baseSeverity: "high",
    question:
      "Does the liveness probe reach a database, broker or other service rather than checking only that this process is responsive? A liveness probe with dependencies converts a dependency slowdown into a cluster-wide restart storm, which is strictly worse than the original fault.",
    evidence:
      "The probe definition, and what the endpoint it calls actually does in the code.",
    reference:
      "Kubernetes docs: Configure Liveness, Readiness and Startup Probes — liveness pitfalls",
    appliesToTechnologies: ["nodejs"],
  },
  {
    id: "NODE.NO_GRACEFUL_SHUTDOWN",
    category: "performance",
    title: "Shutdown drops in-flight requests",
    baseSeverity: "high",
    question:
      "Is there a SIGTERM handler that stops accepting new work and drains in-flight requests, a preStop delay long enough for endpoint propagation, and a terminationGracePeriodSeconds longer than the slowest observed request? Fail when any of the three is missing, because every deploy then returns errors.",
    evidence:
      "terminationGracePeriodSeconds, the preStop hook if any, the signal handling found in the code, and the measured slowest request duration.",
    reference:
      "Kubernetes docs: Pod lifecycle — termination of pods · endpoint propagation delay",
    appliesToTechnologies: ["nodejs"],
  },
  {
    id: "NODE.POOL_VS_DB_CEILING",
    category: "performance",
    title: "Connection pool unsafe against the database ceiling",
    baseSeverity: "high",
    question:
      "What is this service's database connection-pool maximum, and what does pool size multiplied by replica count come to? Fail when that product is a large fraction of the database's own connection ceiling — every replica claims its pool independently, and the database is shared with other services.",
    evidence:
      "The pool maximum and where it is configured, the replica count, the product, and the database's max connections if reachable.",
    reference: "PostgreSQL docs: Connections and Authentication · pool sizing practice",
    appliesToTechnologies: ["nodejs"],
    requires: "code",
  },
  {
    id: "NODE.DEPENDENCY_SLOW",
    category: "performance",
    title: "Outbound dependency dominates request time",
    baseSeverity: "medium",
    question:
      "From full traces, which outbound dependency accounts for most of the request duration, and does it explain the latency measured for the endpoint? Name the dependency and the share of time it takes.",
    evidence:
      "The dependency, its observed span duration, the total request duration, and the trace IDs examined.",
    reference: "Google SRE Workbook: distributed tracing for latency analysis",
    appliesToTechnologies: ["nodejs"],
    requires: "traces",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "NODE.N_PLUS_ONE",
    category: "performance",
    title: "Repeated per-item queries in one request",
    baseSeverity: "medium",
    question:
      "Does any single trace contain the same outbound query or call repeated many times — the N+1 pattern? Report the call, how many times it repeats, and the handler responsible.",
    evidence:
      "The repeated span name, its count within one trace, the trace ID, and the code path that issues it.",
    reference: "Distributed tracing practice: N+1 detection",
    appliesToTechnologies: ["nodejs"],
    requires: "traces",
  },
  {
    id: "NODE.MISSING_TIMEOUTS",
    category: "performance",
    title: "Outbound calls without timeouts",
    baseSeverity: "medium",
    question:
      "Do the outbound HTTP and database calls in the handling path set explicit timeouts? A call with no timeout inherits the operating system's, which is long enough to exhaust the event loop and turn a slow dependency into an outage here.",
    evidence:
      "The call sites read, the timeout configuration found or absent, and the file and revision you read.",
    reference: "Release It! — timeouts and the cascading failure pattern",
    appliesToTechnologies: ["nodejs"],
    requires: "code",
  },
  {
    id: "NODE.RETRY_WITHOUT_BACKOFF",
    category: "performance",
    title: "Retries without backoff or jitter",
    baseSeverity: "medium",
    question:
      "Where the code retries a failed call, does it use exponential backoff with jitter and a bounded attempt count? Immediate or fixed-interval retries amplify a downstream problem into a self-inflicted denial of service.",
    evidence: "The retry implementation, its parameters, and the file and revision.",
    reference: "AWS Architecture Blog: exponential backoff and jitter",
    appliesToTechnologies: ["nodejs"],
    requires: "code",
  },
  {
    id: "NODE.HPA_ON_CPU_ONLY",
    category: "performance",
    title: "Autoscaling on CPU when latency is the constraint",
    baseSeverity: "medium",
    question:
      "If an HPA targets this service, does it scale on CPU alone? A single-threaded service saturated by event-loop work or by a slow dependency shows moderate CPU while queueing badly, so a CPU-only HPA does not scale when it should.",
    evidence:
      "The HPA metrics and thresholds, the observed CPU utilisation, and the measured latency for the same period.",
    reference: "Kubernetes docs: Horizontal Pod Autoscaling — choosing metrics",
    appliesToTechnologies: ["nodejs"],
  },
  {
    id: "NODE.DEBUG_LOGGING_IN_PROD",
    category: "performance",
    title: "Verbose logging in production",
    baseSeverity: "low",
    question:
      "Is the log level set to debug or trace, or NODE_ENV left unset or set to development? Each costs latency on every request and inflates log storage; NODE_ENV also disables framework production optimisations.",
    evidence:
      "The log level and NODE_ENV values with where they are set, and the observed log volume if measurable.",
    reference: "Node.js production best practices: NODE_ENV and logging overhead",
    appliesToTechnologies: ["nodejs"],
  },
];
