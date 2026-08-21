import type {
  CheckRequirement,
  ConcernStatus,
  MonitorCategory,
  MonitorDepth,
  ObservationSource,
  Severity,
  TargetKind,
  WorkloadTechnology,
} from "./types";

/**
 * Presentation vocabulary for the monitoring module — one place so a severity
 * never renders two different colours in two different views.
 *
 * Colour choice follows DESIGN.md: the gold/cobalt accents are syntax-only and
 * must stay inside code/terminal contexts, so severity uses the traffic-light
 * palette already established for tool-call statuses in the chat timeline.
 */

/**
 * The native `<select>` treatment. There is no shadcn Select in this project, so
 * the class list is the component — shared rather than pasted per form, which is
 * how the check editor and the playbook editor ended up looking identical.
 */
export const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-body-sm text-warm-off-white outline-none focus-visible:border-ring";

/**
 * Severity, written out. The check editor's select rendered the raw lowercase enum
 * — the only control in the module that did — so "info" and "critical" arrived as
 * database values in a form where every other choice was a sentence.
 */
export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Info",
};

export const SEVERITY_CLASS: Record<Severity, string> = {
  critical: "text-traffic-red",
  high: "text-traffic-red",
  medium: "text-traffic-yellow",
  low: "text-pale-stone",
  info: "text-bone-gray",
};

/** Critical is filled, high outlined — same hue, different weight. */
export const SEVERITY_FILLED: Record<Severity, boolean> = {
  critical: true,
  high: false,
  medium: false,
  low: false,
  info: false,
};

export const SEVERITY_ORDER: Severity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

export const CONCERN_STATUS_LABEL: Record<ConcernStatus, string> = {
  open: "Open",
  resolved: "Fixed",
  auto_resolved: "No longer detected",
  muted: "Muted",
  accepted_risk: "Accepted risk",
  false_positive: "False positive",
};

export const CONCERN_STATUS_CLASS: Record<ConcernStatus, string> = {
  open: "text-warm-off-white",
  resolved: "text-traffic-green",
  auto_resolved: "text-traffic-green",
  muted: "text-bone-gray",
  accepted_risk: "text-bone-gray",
  false_positive: "text-bone-gray",
};

export const CATEGORY_LABEL: Record<MonitorCategory, string> = {
  security: "Security posture",
  performance: "Performance & reliability",
};

export const TECHNOLOGY_LABEL: Record<WorkloadTechnology, string> = {
  postgresql: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",
  clickhouse: "ClickHouse",
  rabbitmq: "RabbitMQ",
  nodejs: "Node.js",
  kubernetes: "Kubernetes cluster",
};

export const TARGET_KIND_LABEL: Record<TargetKind, string> = {
  deployment: "Deployments",
  statefulset: "StatefulSets",
  cluster: "The cluster itself",
};

/**
 * A check's reach as one sentence — "Deployments & StatefulSets · only
 * PostgreSQL · never ClickHouse".
 *
 * Shared by the catalogue's read view and the editor's collapsed Scope summary
 * on purpose: the editor hides forty checkboxes behind this line, so the line
 * has to say exactly what the checkboxes would, or the disclosure is a lie.
 *
 * The empty cases are the whole reason it exists. An empty `appliesTo` means
 * every workload kind and pointedly not the cluster, and an empty technology
 * list reaches workloads whose technology was never identified — neither is
 * readable from a grid of ticked boxes.
 */
export function describeScope(scope: {
  appliesTo: readonly string[];
  appliesToTechnologies: readonly string[];
  excludesTechnologies: readonly string[];
}): string {
  const technologies = (list: readonly string[]) =>
    list.map((t) => TECHNOLOGY_LABEL[t as WorkloadTechnology] ?? t).join(", ");

  const parts = [
    scope.appliesTo.length === 0
      ? "Every workload kind"
      : scope.appliesTo
          .map((k) => TARGET_KIND_LABEL[k as TargetKind] ?? k)
          .join(" & "),
  ];
  if (scope.appliesToTechnologies.length > 0)
    parts.push(`only ${technologies(scope.appliesToTechnologies)}`);
  if (scope.excludesTechnologies.length > 0)
    parts.push(`never ${technologies(scope.excludesTechnologies)}`);
  return parts.join(" · ");
}

export const DEPTH_LABEL: Record<MonitorDepth, string> = {
  posture: "Posture",
  deep: "Deep",
};

export const DEPTH_BLURB: Record<MonitorDepth, string> = {
  posture:
    "One assessment covering every selected workload, answering configuration questions from the Kubernetes spec. Cheap enough to run often.",
  deep: "One full investigation per workload against its technology's playbook — metrics, logs, the engine itself — returning measured values. Minutes and real money per workload, so weekly or on demand.",
};

export const OBSERVATION_SOURCE_LABEL: Record<ObservationSource, string> = {
  manifest: "Manifest",
  node: "Node",
  metrics: "Metrics",
  logs: "Logs",
  engine: "Engine",
  traces: "Traces",
  code: "Code",
};

export const RUN_STATUS_CLASS: Record<string, string> = {
  queued: "text-bone-gray",
  running: "text-traffic-yellow",
  completed: "text-traffic-green",
  failed: "text-traffic-red",
};

/** Worst severity in a list, for cluster/job rollup dots. */
export function worstSeverity(
  severities: readonly Severity[],
): Severity | null {
  for (const severity of SEVERITY_ORDER) {
    if (severities.includes(severity)) return severity;
  }
  return null;
}

export const REQUIREMENT_LABEL: Record<CheckRequirement, string> = {
  prometheus: "Prometheus metrics",
  // Separate from `prometheus` because it fails separately and often: the
  // kube-prometheus-stack ServiceMonitors for etcd, the scheduler and the
  // controller-manager need certificates and non-loopback bind addresses, and on
  // a managed control plane they cannot work at all. Without this requirement
  // "etcd fsync is fine" and "we never scraped etcd" are the same answer.
  "control-plane-metrics":
    "scrapeable control-plane components (etcd, kube-scheduler, kube-controller-manager)",
  "metrics-server": "metrics-server (kubectl top)",
  // Named for the common case; it means the engine's own query interface, which for
  // MongoDB is the database command surface rather than SQL. Kept as-is rather than
  // renamed because ~20 seeded checks reference the value and the label carries the
  // meaning perfectly well.
  "engine-sql":
    "a read-only query connection to the engine itself (SQL, or its equivalent on a non-relational engine)",
  "pg-stat-statements": "the pg_stat_statements extension, loaded and enabled",
  "performance-schema": "MySQL performance_schema, enabled",
  "queue-api": "the broker's management API",
  logs: "pod logs or Loki",
  traces: "distributed traces",
  node: "read access to the node the workload runs on",
  code: "read access to the service's source repository",
};

/**
 * Schedule presets for the job form. Label/expression pairs only: they live
 * here rather than beside the cron parser in `schedule.ts` because importing
 * them from there pulled `cron-parser` into the client bundle of the two
 * heaviest routes in the module for no runtime benefit.
 */
export const SCHEDULE_PRESETS = [
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at 06:00 UTC", expression: "0 6 * * *" },
  { label: "Weekdays at 06:00 UTC", expression: "0 6 * * 1-5" },
  { label: "Weekly, Monday 06:00 UTC", expression: "0 6 * * 1" },
] as const;

/**
 * Short forms for the requirement select, where {@link REQUIREMENT_LABEL} is a
 * sentence. Sparse on purpose: most labels are already a couple of words, and a
 * second complete copy of the vocabulary is a second thing to keep in step. The
 * full label is still shown, as the field's description.
 */
export const REQUIREMENT_SHORT: Partial<Record<CheckRequirement, string>> = {
  "control-plane-metrics": "Control-plane metrics",
  "engine-sql": "A query connection to the engine",
  "pg-stat-statements": "pg_stat_statements",
  "performance-schema": "performance_schema",
  "queue-api": "The broker's management API",
  node: "Node access",
  code: "Source access",
};

export function requirementLabel(requirement: CheckRequirement): string {
  return REQUIREMENT_SHORT[requirement] ?? REQUIREMENT_LABEL[requirement];
}
