import type {
  ConcernStatus,
  MonitorCategory,
  MonitorDepth,
  ObservationSource,
  Severity,
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
};

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
