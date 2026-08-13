import type { MonitorCategory, Severity, WorkloadKind } from "./types";

/**
 * THE BUILT-IN RUBRIC — the reviewed, cited seed for the live catalogue.
 *
 * These definitions live in git (not just in a database) because their value is
 * the citation trail: each check names the standard that codifies it, so a
 * severity is defensible rather than invented. They are seeded into
 * `monitoring_checks` on first use and NEVER overwritten afterwards, so an admin
 * can retune or disable one without a deploy and without losing this record of
 * where it came from.
 *
 * The LIVE rubric is the `monitoring_checks` table — read it through
 * `lib/monitoring/checks.ts`, never from this array. Admins may also add custom
 * checks that exist only in the database.
 *
 * Why a rubric at all: an LLM asked "is this workload healthy?" invents
 * different titles and severities on every run, which destroys deduplication —
 * the same problem would reappear as a new concern every night. So Drill
 * declares the checks and Holmes only ever answers *these* questions: it
 * supplies evidence, prose and a context-adjusted severity, never identity.
 *
 * IDs are permanent. Renaming one orphans every concern that references it.
 */

/** Extra data a check needs, which the cluster may not have. */
export type CheckRequirement = "prometheus" | "metrics-server";

export const REQUIREMENT_LABEL: Record<CheckRequirement, string> = {
  prometheus: "Prometheus metrics",
  "metrics-server": "metrics-server (kubectl top)",
};

export interface MonitorCheck {
  /** Permanent, stable identifier. Never rename. */
  id: string;
  category: MonitorCategory;
  title: string;
  /** Severity declared by the catalogue, independent of any single run. */
  baseSeverity: Severity;
  /** The precise question Holmes must answer for one workload. */
  question: string;
  /** What must be cited as evidence when the check fails. */
  evidence: string;
  /** The standard or tool that codifies this check. */
  reference: string;
  /** Omitted = applies to both Deployments and StatefulSets. */
  appliesTo?: WorkloadKind[];
  /** Telemetry the check depends on; absent ⇒ Holmes must skip, not pass. */
  requires?: CheckRequirement;
  /**
   * Consecutive runs that must evaluate the check without it failing before the
   * concern auto-resolves. Metric-driven checks flap, so they need two.
   */
  resolveAfterAbsentRuns?: number;
}

const SECURITY_CHECKS: MonitorCheck[] = [
  {
    id: "SEC.PRIVILEGED",
    category: "security",
    title: "Privileged container",
    baseSeverity: "critical",
    question:
      "Does any container run with securityContext.privileged: true (full host access)?",
    evidence: "The container name and the privileged setting.",
    reference: "kubescape C-0057 · PSS Baseline: Privileged Containers",
  },
  {
    id: "SEC.HOST_NAMESPACE",
    category: "security",
    title: "Host namespace sharing",
    baseSeverity: "critical",
    question:
      "Does the pod spec set hostNetwork, hostPID or hostIPC to true, breaking pod isolation?",
    evidence: "Which of the three fields is enabled.",
    reference: "kubescape C-0038 / C-0041 · PSS Baseline: Host Namespaces",
  },
  {
    id: "SEC.RBAC_OVERPRIVILEGED",
    category: "security",
    title: "Over-privileged ServiceAccount",
    baseSeverity: "critical",
    question:
      "Do the Roles/ClusterRoles bound to this workload's ServiceAccount grant cluster-admin, wildcard verbs or resources, secret list/get cluster-wide, pod create/exec, or escalate/bind/impersonate?",
    evidence:
      "The ServiceAccount name, the binding, and the specific offending rule (verbs + resources).",
    reference: "kubescape C-0272 / C-0186 / C-0188 / C-0191 · CIS 5.1",
  },
  {
    id: "SEC.PRIV_ESCALATION",
    category: "security",
    title: "Privilege escalation allowed",
    baseSeverity: "high",
    question:
      "Is allowPrivilegeEscalation left unset or true on any container (setuid binaries can gain privileges)?",
    evidence: "The container name and the effective setting.",
    reference: "kubescape C-0016 · Trivy KSV001 · PSS Restricted",
  },
  {
    id: "SEC.RUN_AS_ROOT",
    category: "security",
    title: "Container runs as root",
    baseSeverity: "high",
    question:
      "Is runAsNonRoot unset/false, or runAsUser 0, so containers run as uid 0?",
    evidence:
      "The container name, runAsNonRoot/runAsUser values, and the image's own default user if known.",
    reference: "kubescape C-0013 · PSS Restricted: Running as Non-root",
  },
  {
    id: "SEC.HOST_PATH",
    category: "security",
    title: "hostPath volume mounted",
    baseSeverity: "high",
    question:
      "Does the pod mount a hostPath volume, exposing the node filesystem (and is it writable)?",
    evidence: "The volume name, host path, mount path, and readOnly flag.",
    reference: "kubescape C-0045 / C-0048 · PSS Baseline: HostPath Volumes",
  },
  {
    id: "SEC.CAPABILITIES",
    category: "security",
    title: "Dangerous Linux capabilities",
    baseSeverity: "high",
    question:
      "Does any container add capabilities beyond the Baseline allowlist (e.g. SYS_ADMIN, NET_RAW, SYS_PTRACE), or fail to drop ALL?",
    evidence: "The container name and its capabilities.add / capabilities.drop lists.",
    reference: "kubescape C-0046 · Trivy KSV003 · PSS Baseline: Capabilities",
  },
  {
    id: "SEC.RO_ROOT_FS",
    category: "security",
    title: "Writable root filesystem",
    baseSeverity: "medium",
    question:
      "Is readOnlyRootFilesystem unset or false, letting a compromised process modify the container image at runtime?",
    evidence: "The container name and the effective setting.",
    reference: "kubescape C-0017 · Polaris notReadOnlyRootFilesystem",
  },
  {
    id: "SEC.SECCOMP",
    category: "security",
    title: "No seccomp profile",
    baseSeverity: "medium",
    question:
      "Is seccompProfile unset (rather than RuntimeDefault or Localhost) at pod or container level?",
    evidence: "Where the profile is missing (pod vs container) and any value found.",
    reference: "kubescape C-0210 · PSS Restricted: Seccomp",
  },
  {
    id: "SEC.SA_TOKEN_AUTOMOUNT",
    category: "security",
    title: "ServiceAccount token auto-mounted",
    baseSeverity: "medium",
    question:
      "Is automountServiceAccountToken left enabled when the workload does not call the Kubernetes API?",
    evidence:
      "The setting on the pod spec and ServiceAccount, plus any sign the workload does use the API.",
    reference: "kubescape C-0034 / C-0261 / C-0190",
  },
  {
    id: "SEC.SECRETS_AS_ENV",
    category: "security",
    title: "Secrets injected as environment variables",
    baseSeverity: "medium",
    question:
      "Are Secrets consumed via env/envFrom (visible to any process and in crash dumps) rather than mounted as files?",
    evidence:
      "The referenced Secret NAMES and env var names only — never read or echo secret values.",
    reference: "kubescape C-0207 · NSA/CISA Kubernetes Hardening Guide",
  },
  {
    id: "SEC.NO_NETWORK_POLICY",
    category: "security",
    title: "No NetworkPolicy selects these pods",
    baseSeverity: "medium",
    question:
      "Is there no NetworkPolicy in the namespace whose podSelector matches this workload's labels, leaving traffic unrestricted?",
    evidence:
      "The namespace's NetworkPolicies and why none match this workload's labels.",
    reference: "kubescape C-0260 · Polaris missingNetworkPolicy · OWASP K05",
  },
  {
    id: "SEC.MUTABLE_IMAGE_TAG",
    category: "security",
    title: "Mutable or unpinned image tag",
    baseSeverity: "medium",
    question:
      "Does any container use :latest, no tag, or a floating tag instead of a pinned version or digest?",
    evidence: "The container name and full image reference.",
    reference: "kubescape C-0075 · Polaris tagNotSpecified",
  },
  {
    id: "SEC.DEFAULT_NAMESPACE",
    category: "security",
    title: "Runs in the default namespace",
    baseSeverity: "low",
    question:
      "Is the workload deployed in the `default` namespace, where isolation and policy scoping are weakest?",
    evidence: "The namespace.",
    reference: "kubescape C-0061 / C-0212",
  },
];

const PERFORMANCE_CHECKS: MonitorCheck[] = [
  {
    id: "PERF.OOM_KILLS",
    category: "performance",
    title: "Containers OOMKilled",
    baseSeverity: "critical",
    question:
      "Have any of this workload's containers terminated with reason OOMKilled recently?",
    evidence:
      "Pod name, container, termination reason/exit code, when it happened, and the memory limit.",
    reference: "kube-state-metrics last_terminated_reason · KRR memory strategy",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.RESTART_CHURN",
    category: "performance",
    title: "Restart churn / CrashLoopBackOff",
    baseSeverity: "critical",
    question:
      "Are pods restarting repeatedly or sitting in CrashLoopBackOff rather than running steadily?",
    evidence:
      "Pod names, restart counts, waiting reason, and the failing container's last log lines or exit code.",
    reference: "kube-prometheus KubePodCrashLooping",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.REPLICAS_UNAVAILABLE",
    category: "performance",
    title: "Fewer ready replicas than desired",
    baseSeverity: "critical",
    question:
      "Does status show fewer ready/available replicas than spec.replicas, and for how long?",
    evidence: "Desired vs ready vs available counts, and why the missing pods are not ready.",
    reference:
      "kube-prometheus KubeDeploymentReplicasMismatch / KubeStatefulSetReplicasMismatch",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.PENDING_PODS",
    category: "performance",
    title: "Pods pending or unschedulable",
    baseSeverity: "high",
    question:
      "Are any pods stuck Pending — unschedulable for want of CPU/memory, node selectors, taints or volumes?",
    evidence: "Pod name and the scheduler's FailedScheduling event message.",
    reference: "kube-prometheus KubePodNotReady · k8sgpt podAnalyzer",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.ROLLOUT_STUCK",
    category: "performance",
    title: "Rollout stuck or incomplete",
    baseSeverity: "high",
    question:
      "Is a rollout unfinished — Progressing=False, observedGeneration behind metadata.generation, or updated replicas short of desired?",
    evidence: "The relevant status conditions, generations, and updated/current replica counts.",
    reference:
      "kube-prometheus KubeDeploymentRolloutStuck / KubeStatefulSetUpdateNotRolledOut",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.NO_RESOURCE_REQUESTS",
    category: "performance",
    title: "Missing CPU/memory requests",
    baseSeverity: "high",
    question:
      "Does any container omit resources.requests for CPU or memory, leaving the scheduler blind and the pod BestEffort?",
    evidence: "Container name and which request is missing.",
    reference: "Polaris cpuRequestsMissing / memoryRequestsMissing · kubescape C-0268",
  },
  {
    id: "PERF.NO_RESOURCE_LIMITS",
    category: "performance",
    title: "Missing memory limit",
    baseSeverity: "high",
    question:
      "Does any container omit resources.limits.memory, so it can consume the node and trigger evictions?",
    evidence: "Container name and the limits block as configured.",
    reference: "Polaris memoryLimitsMissing · kubescape C-0270",
  },
  {
    id: "PERF.CPU_THROTTLING",
    category: "performance",
    title: "CPU throttling",
    baseSeverity: "high",
    question:
      "What fraction of CFS periods are throttled — rate(container_cpu_cfs_throttled_periods_total) / rate(container_cpu_cfs_periods_total) — over the last hour? Fail above 0.10.",
    evidence: "The throttled ratio, the CPU limit, and observed CPU usage.",
    reference: "kube-prometheus cAdvisor CFS metrics",
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.HPA_SATURATED",
    category: "performance",
    title: "HPA pinned at maxReplicas",
    baseSeverity: "high",
    question:
      "If an HPA targets this workload, is it sitting at maxReplicas (no headroom left) or unable to compute metrics?",
    evidence: "HPA name, current/desired/min/max replicas, and its conditions.",
    reference: "kube-prometheus KubeHpaMaxedOut / KubeHpaReplicasMismatch",
    appliesTo: ["deployment"],
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.PVC_PRESSURE",
    category: "performance",
    title: "PersistentVolume near capacity",
    baseSeverity: "high",
    question:
      "Are any of this StatefulSet's PVCs above 80% used, unbound, or failing to provision?",
    evidence: "PVC name, capacity, used percentage, and phase.",
    reference: "kube-prometheus KubePersistentVolumeFillingUp · k8sgpt pvcAnalyzer",
    appliesTo: ["statefulset"],
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.RIGHT_SIZING",
    category: "performance",
    title: "Requests far from actual usage",
    baseSeverity: "medium",
    question:
      "Compare requests with real usage over the past week (KRR heuristic: CPU at the 95th percentile, memory at max + 15%). Fail when a request is over 3x or under 0.5x that figure.",
    evidence: "Requested vs recommended CPU and memory, with the observed figures.",
    reference: "Robusta KRR · Fairwinds Goldilocks",
    requires: "prometheus",
    resolveAfterAbsentRuns: 2,
  },
  {
    id: "PERF.NO_PROBES",
    category: "performance",
    title: "Missing readiness or liveness probe",
    baseSeverity: "medium",
    question:
      "Does any container lack a readinessProbe (traffic sent before it is ready) or a livenessProbe (hung processes never restarted)?",
    evidence: "Container name and which probe is missing.",
    reference: "kubescape C-0018 / C-0056 · Polaris readinessProbeMissing",
  },
  {
    id: "PERF.PROBE_MISCONFIG",
    category: "performance",
    title: "Probe configuration likely to cause flapping",
    baseSeverity: "medium",
    question:
      "Are probes configured to destabilise the workload — liveness identical to readiness, timeoutSeconds too tight for the endpoint, no initialDelaySeconds/startupProbe for a slow starter, or failureThreshold of 1?",
    evidence: "The probe definitions and the specific setting at fault.",
    reference: "Kubernetes probe configuration guidance · Komodor reliability checklist",
  },
  {
    id: "PERF.SINGLE_REPLICA",
    category: "performance",
    title: "Single replica — no redundancy",
    baseSeverity: "medium",
    question:
      "Does the workload run one replica, so any node drain, eviction or crash is a full outage?",
    evidence: "spec.replicas, and whether an HPA raises the floor.",
    reference: "Polaris deploymentMissingReplicas",
  },
  {
    id: "PERF.NO_PDB",
    category: "performance",
    title: "No PodDisruptionBudget",
    baseSeverity: "medium",
    question:
      "Is there no PDB selecting these pods (or one whose minAvailable cannot be satisfied), so a node drain can take the service down?",
    evidence: "PDBs in the namespace and why none apply, or the unsatisfiable numbers.",
    reference: "Polaris missingPodDisruptionBudget · kube-prometheus KubePdbNotEnoughHealthyPods",
  },
  {
    id: "PERF.NO_TOPOLOGY_SPREAD",
    category: "performance",
    title: "No topology spread or anti-affinity",
    baseSeverity: "low",
    question:
      "For a multi-replica workload, are all replicas free to land on one node — no topologySpreadConstraints and no pod anti-affinity?",
    evidence: "The scheduling constraints present, and the current pod-to-node distribution.",
    reference: "Polaris topologySpreadConstraint · Komodor reliability checklist",
  },
];

/** The seed set. The live rubric is the DB — see lib/monitoring/checks.ts. */
export const BUILTIN_CHECKS: readonly MonitorCheck[] = Object.freeze([
  ...SECURITY_CHECKS,
  ...PERFORMANCE_CHECKS,
]);

/**
 * Narrow a resolved catalogue to what applies here. Pure, so it works on
 * checks from the database as well as on the built-in seed.
 */
export function applicableChecks<T extends MonitorCheck>(
  checks: readonly T[],
  category: MonitorCategory,
  kinds: readonly WorkloadKind[] = ["deployment", "statefulset"],
): T[] {
  return checks.filter(
    (c) =>
      c.category === category &&
      (!c.appliesTo?.length || c.appliesTo.some((k) => kinds.includes(k))),
  );
}

/** Check-ID validity for admin-authored checks. Uppercase, dotted, immutable. */
export const CHECK_ID_PATTERN = /^[A-Z][A-Z0-9]*\.[A-Z0-9_]{2,}$/;

export function validateCheckId(raw: unknown): string {
  const id = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!CHECK_ID_PATTERN.test(id))
    throw new Error(
      "A check ID looks like PREFIX.NAME — uppercase letters, digits and underscores, e.g. CUSTOM.INGRESS_TLS. It can never be changed afterwards, because concerns reference it by value.",
    );
  return id;
}

/**
 * What a security job can NOT tell you. Holmes has no vulnerability scanner
 * (no Trivy/kubescape/CVE toolset exists) and its RBAC deliberately excludes
 * Secret values, so these assessments are configuration posture only. Shown in
 * the UI so the feature does not overpromise.
 */
export const SECURITY_SCOPE_CAVEAT =
  "Configuration posture only — Holmes has no image-vulnerability scanner and cannot read Secret values. " +
  "CVE scanning and secret-content leakage are out of scope.";
