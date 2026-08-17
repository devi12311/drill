import {
  WORKLOAD_TECHNOLOGIES,
  type WorkloadTechnology,
} from "./types";

/**
 * Which software runs inside a workload, inferred from what discovery already
 * collects. This is the keystone of technology-aware assessment: without it there
 * is nowhere to hang "compare shared_buffers against the node's memory".
 *
 * Deliberately deterministic and cheap — it reads no cluster state of its own.
 * Discovery already lists every Deployment and StatefulSet, so images, labels and
 * container names come free from the API call we are making anyway; nothing here
 * costs an extra request, and no LLM is involved in deciding what a workload IS.
 *
 * Detection is a best guess and is treated as one. Every workload carries a human
 * override (`monitoring_workloads.technology_override`), because a service built
 * from a private base image cannot be identified from the outside and guessing
 * confidently would be worse than admitting it.
 */

export interface TechnologyGuess {
  technology: WorkloadTechnology;
  /** Why we think so — rendered in the picker so a wrong guess is arguable. */
  reason: string;
}

export interface TechnologyInput {
  images: string[];
  /** Workload labels, if the caller collected them. */
  labels?: Record<string, string>;
  containerNames?: string[];
}

/** Label values that name a technology outright, keyed by normalised value. */
const LABEL_VALUES: Record<string, WorkloadTechnology> = {
  postgres: "postgresql",
  postgresql: "postgresql",
  mysql: "mysql",
  mongo: "mongodb",
  mongodb: "mongodb",
  clickhouse: "clickhouse",
  rabbitmq: "rabbitmq",
  rabbit: "rabbitmq",
  node: "nodejs",
  nodejs: "nodejs",
};

/** Labels that conventionally carry the application's name. */
const NAME_LABELS = ["app.kubernetes.io/name", "app", "application"];

/**
 * Image-reference patterns, most specific first. Matched against the repository
 * path with the tag and digest stripped, so both `mysql:8` and
 * `ghcr.io/cloudnative-pg/postgresql:16.2` resolve.
 */
const IMAGE_RULES: { pattern: RegExp; technology: WorkloadTechnology }[] = [
  { pattern: /percona-server-mongodb|mongodb|mongo\b/, technology: "mongodb" },
  {
    // `spilo` and `patroni` are Zalando's PostgreSQL images and carry no other
    // marker — without them the actual database StatefulSet goes undetected while
    // its exporter and operator get picked up instead.
    pattern: /cloudnative-pg|timescaledb|postgresql|postgres|spilo|patroni/,
    technology: "postgresql",
  },
  { pattern: /percona-(server-)?mysql|percona-xtradb|mysql/, technology: "mysql" },
  { pattern: /clickhouse/, technology: "clickhouse" },
  { pattern: /rabbitmq/, technology: "rabbitmq" },
  { pattern: /(^|[/-])node(js)?(\b|[-:])/, technology: "nodejs" },
];

/**
 * Images that merely mention a technology without BEING it: its exporter, its
 * operator, its connection pooler, its admin UI. Every one of these matches the
 * engine patterns above on name alone — `postgres-exporter` and
 * `postgres-operator` are the real examples that made this necessary — and
 * assessing an exporter against a database rubric produces nothing but noise.
 */
const ADJUNCT_IMAGE =
  /(^|[/\-_])(exporter|operator|pooler|pgbouncer|proxysql|proxy|router|keeper|grafana|metrics|dashboard|ui|backup|sidecar|init|migrator)([-_:]|$)/;

/**
 * This cluster names every Node.js microservice `ms-<something>`, in the image, the
 * Bitbucket repo and the trace `service.name` alike (HOLMES_KNOWLEDGE_BASE.md §5).
 * Those images are built in-house and carry no runtime marker, so the convention
 * is the only available signal — and it must beat the engine patterns below, or a
 * service called `ms-postgres-sync` gets assessed as if it were a database.
 */
const MICROSERVICE_IMAGE = /(^|\/)ms-[a-z0-9][a-z0-9-]*(:|$)/;

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

function fromLabels(labels: Record<string, string>): TechnologyGuess | null {
  for (const key of NAME_LABELS) {
    const raw = labels[key];
    if (!raw) continue;
    const technology = LABEL_VALUES[raw.trim().toLowerCase()];
    if (technology) return { technology, reason: `label ${key}=${raw}` };
  }
  return null;
}

function fromImages(images: readonly string[]): TechnologyGuess | null {
  const candidates = images
    .map(imageRepository)
    .filter((repository) => !ADJUNCT_IMAGE.test(repository));
  for (const repository of candidates) {
    if (MICROSERVICE_IMAGE.test(repository))
      return { technology: "nodejs", reason: `image ${repository} (ms-* service)` };
  }
  for (const repository of candidates) {
    for (const rule of IMAGE_RULES) {
      if (rule.pattern.test(repository))
        return { technology: rule.technology, reason: `image ${repository}` };
    }
  }
  return null;
}

/**
 * Container names are a weak signal, used only when images and labels say
 * nothing — an operator-built pod whose image is opaque may still run a container
 * called `mongod` or `postgres`.
 */
function fromContainerNames(names: readonly string[]): TechnologyGuess | null {
  for (const name of names) {
    const normalised = name.trim().toLowerCase();
    for (const rule of IMAGE_RULES) {
      if (rule.pattern.test(normalised))
        return { technology: rule.technology, reason: `container ${name}` };
    }
  }
  return null;
}

/** Best guess at what runs inside a workload, or null when nothing is recognised. */
export function detectTechnology(input: TechnologyInput): TechnologyGuess | null {
  return (
    (input.labels ? fromLabels(input.labels) : null) ??
    fromImages(input.images) ??
    (input.containerNames ? fromContainerNames(input.containerNames) : null)
  );
}

/** Narrow an arbitrary stored string back to the vocabulary. */
export function asTechnology(raw: unknown): WorkloadTechnology | null {
  return typeof raw === "string" &&
    (WORKLOAD_TECHNOLOGIES as readonly string[]).includes(raw)
    ? (raw as WorkloadTechnology)
    : null;
}
