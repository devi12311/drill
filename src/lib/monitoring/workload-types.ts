import type { CatalogueProvenance } from "./types";

/**
 * Workload types as DATA (docs/DECISIONS.md 128): what a workload can be
 * (PostgreSQL, Redis, "our Node.js services"), and how discovery recognises it.
 * Client-safe — the types screen previews detection with the very matcher
 * discovery runs.
 *
 * Detection patterns are TOKEN patterns, never regular expressions: org admins
 * are tenants, detection runs in the shared server process, and a pathological
 * regex would stall discovery for everyone. A name is split into tokens on
 * `/ - _ . : @` and a pattern matches when its own tokens appear CONSECUTIVELY.
 * Tokens are whole words — `postgres` does not match `postgresql`, so list both —
 * which is what gives word boundaries without regex: `cloudnative-pg` matches
 * `ghcr.io/cloudnative-pg/postgresql`, and `ms` matches `registry/ms-campaigns`
 * but not `msql`.
 */

/** The one technology whose subject is the cluster, never a workload type. */
export const CLUSTER_TECHNOLOGY = "kubernetes";
export const CLUSTER_TECHNOLOGY_LABEL = "Kubernetes cluster";

/** A type's identity — a stored slug, never renamed (checks and workloads reference it). */
export const WORKLOAD_TYPE_SLUG = /^[a-z][a-z0-9-]{1,31}$/;

export const WORKLOAD_TYPE_LIMITS = {
  label: 60,
  /** Per list. */
  entries: 30,
  entry: 60,
  priority: { min: -100, max: 100 },
} as const;

export interface WorkloadTypeRules {
  /** Exact values of app.kubernetes.io/name, app or application. */
  labelValues: string[];
  /** Token patterns matched against image repositories and container names. */
  patterns: string[];
}

export interface WorkloadTypeDraft extends WorkloadTypeRules {
  label: string;
  /** Higher is checked first; the shipped types use 0-50. */
  priority: number;
  enabled: boolean;
}

/** A type as the screens show it. */
export interface WorkloadTypeView extends WorkloadTypeDraft, CatalogueProvenance {
  slug: string;
  builtin: boolean;
  version: number;
}

/** What detection needs of a type — the effective, enabled ones, in priority order. */
export interface DetectableType extends WorkloadTypeRules {
  slug: string;
  priority: number;
}

export interface TechnologyGuess {
  technology: string;
  /** Why we think so — rendered in the picker so a wrong guess is arguable. */
  reason: string;
}

export interface TechnologyInput {
  images: string[];
  labels?: Record<string, string>;
  containerNames?: string[];
}

export function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[/\-_.:@]+/)
    .filter(Boolean);
}

/** Does `pattern`'s token sequence occur consecutively in `tokens`? */
export function matchesPattern(tokens: readonly string[], pattern: string): boolean {
  const want = tokenize(pattern);
  if (want.length === 0) return false;
  for (let i = 0; i + want.length <= tokens.length; i++) {
    if (want.every((t, j) => tokens[i + j] === t)) return true;
  }
  return false;
}

/**
 * Images that merely mention a technology without BEING it: its exporter, its
 * operator, its connection pooler, its admin UI. Product behaviour, not
 * vocabulary — `postgres-exporter` is never PostgreSQL, whoever defined the type —
 * so it stays in code rather than on each type.
 */
const ADJUNCT_TOKENS = new Set([
  "exporter", "operator", "pooler", "pgbouncer", "proxysql", "proxy", "router",
  "keeper", "grafana", "metrics", "dashboard", "ui", "backup", "sidecar", "init",
  "migrator",
]);

/** Labels that conventionally carry the application's name. */
const NAME_LABELS = ["app.kubernetes.io/name", "app", "application"];

/** Strip the tag or digest from an image reference, leaving the repository path. */
function imageRepository(image: string): string {
  const withoutDigest = image.split("@")[0];
  // Only the last colon can start a tag, and only if it is after the last slash
  // (a registry host may carry a port: `registry:5000/foo`).
  const lastColon = withoutDigest.lastIndexOf(":");
  const lastSlash = withoutDigest.lastIndexOf("/");
  const repository =
    lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
  return repository.toLowerCase();
}

/** Highest priority first; ties broken by slug so detection is deterministic. */
export function byPriority<T extends { slug: string; priority: number }>(types: T[]): T[] {
  return [...types].sort((a, b) => b.priority - a.priority || a.slug.localeCompare(b.slug));
}

function firstMatch(
  types: readonly DetectableType[],
  name: string,
): DetectableType | undefined {
  const tokens = tokenize(name);
  return types.find((t) => t.patterns.some((p) => matchesPattern(tokens, p)));
}

/**
 * Best guess at what runs inside a workload, or null. Labels first (an explicit
 * name), then images (adjuncts skipped), then container names as the weak
 * signal — each step trying the types in priority order. `types` must already be
 * the org's effective, enabled types sorted with `byPriority`.
 */
export function detectTechnology(
  input: TechnologyInput,
  types: readonly DetectableType[],
): TechnologyGuess | null {
  for (const key of NAME_LABELS) {
    const raw = input.labels?.[key]?.trim().toLowerCase();
    if (!raw) continue;
    const hit = types.find((t) => t.labelValues.includes(raw));
    if (hit) return { technology: hit.slug, reason: `label ${key}=${input.labels![key]}` };
  }
  const repositories = input.images
    .map(imageRepository)
    .filter((repo) => !tokenize(repo).some((t) => ADJUNCT_TOKENS.has(t)));
  // Priority beats image order: a high-priority convention (an org's `ms-*`
  // services) must win even over an engine named later in the same image.
  for (const type of types) {
    for (const repository of repositories) {
      if (type.patterns.some((p) => matchesPattern(tokenize(repository), p)))
        return { technology: type.slug, reason: `image ${repository}` };
    }
  }
  for (const name of input.containerNames ?? []) {
    const hit = firstMatch(types, name);
    if (hit) return { technology: hit.slug, reason: `container ${name}` };
  }
  return null;
}

function list(raw: unknown, field: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error(`${field} must be a list`);
  const out = [
    ...new Set(
      raw
        .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
        .filter(Boolean),
    ),
  ];
  if (out.length > WORKLOAD_TYPE_LIMITS.entries)
    throw new Error(`${field}: at most ${WORKLOAD_TYPE_LIMITS.entries} entries`);
  for (const v of out)
    if (v.length > WORKLOAD_TYPE_LIMITS.entry)
      throw new Error(`${field}: "${v.slice(0, 20)}…" is longer than ${WORKLOAD_TYPE_LIMITS.entry} characters`);
  return out;
}

/** Throws with a user-facing message, like the check and playbook parsers. */
export function parseWorkloadTypeDraft(
  body: Record<string, unknown>,
  existing?: WorkloadTypeDraft,
): WorkloadTypeDraft {
  const label =
    body.label === undefined ? (existing?.label ?? "") : String(body.label).trim();
  if (!label) throw new Error("A label is required");
  if (label.length > WORKLOAD_TYPE_LIMITS.label)
    throw new Error(`Label: at most ${WORKLOAD_TYPE_LIMITS.label} characters`);
  const priority =
    body.priority === undefined ? (existing?.priority ?? 0) : Number(body.priority);
  const { min, max } = WORKLOAD_TYPE_LIMITS.priority;
  if (!Number.isInteger(priority) || priority < min || priority > max)
    throw new Error(`Priority must be a whole number from ${min} to ${max}`);
  return {
    label,
    priority,
    enabled: body.enabled === undefined ? (existing?.enabled ?? true) : body.enabled === true,
    labelValues:
      body.labelValues === undefined ? (existing?.labelValues ?? []) : list(body.labelValues, "Label values"),
    patterns:
      body.patterns === undefined ? (existing?.patterns ?? []) : list(body.patterns, "Patterns"),
  };
}

export function validateWorkloadTypeSlug(raw: unknown): string {
  const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!WORKLOAD_TYPE_SLUG.test(slug))
    throw new Error("Slug: 2-32 characters, lowercase letters, digits and hyphens, starting with a letter");
  if (slug === CLUSTER_TECHNOLOGY)
    throw new Error(`"${CLUSTER_TECHNOLOGY}" is reserved for the cluster itself`);
  return slug;
}
