import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";
import type { WorkloadTechnology } from "../types";
import type { WorkloadTypeDraft } from "../workload-types";
import { CLICKHOUSE_CHECKS, CLICKHOUSE_PLAYBOOK } from "./clickhouse";
import { KUBERNETES_CHECKS, KUBERNETES_PLAYBOOK } from "./kubernetes";
import { MONGODB_CHECKS, MONGODB_PLAYBOOK } from "./mongodb";
import { MYSQL_CHECKS, MYSQL_PLAYBOOK } from "./mysql";
import { NODEJS_CHECKS, NODEJS_PLAYBOOK } from "./nodejs";
import { POSTGRESQL_CHECKS, POSTGRESQL_PLAYBOOK } from "./postgresql";
import { RABBITMQ_CHECKS, RABBITMQ_PLAYBOOK } from "./rabbitmq";

/**
 * TECHNOLOGY PROFILES — the registry.
 *
 * A profile pairs a playbook (the method: where the data is and how to measure it)
 * with the checks that method exists to answer. One file per technology, registered
 * here, so adding a technology is: write the file, add it to this list, no migration
 * — both halves seed themselves into their live tables on first read.
 *
 * NOTE what this registry is, now that both halves are editable data: the SEED and
 * the reviewed original, not what a run reads. Checks are read through
 * `checks.ts`, methods through `playbooks.ts`, and each has an admin screen. This
 * file is what a fresh database's TEMPLATES are filled from — which is why the text
 * stays here, in git, where it can be reviewed and can cite its sources. It must stay
 * generic: facts about one install belong in that org's own copy (decision 127).
 *
 * Every shipped workload type has a profile here (more can be added as data). Kafka and ksqlDB
 * deliberately are not in that vocabulary at all: neither has a Holmes toolset
 * or a Prometheus exporter on the first install, and Kafka's binary protocol defeats the
 * bash/curl fallback entirely — a profile without data produces confident nonsense
 * rather than an assessment, so the plumbing is the prerequisite, not the code.
 *
 * `kubernetes` is the one profile whose subject is not software inside a workload: it
 * assesses the cluster itself, reached through the `cluster` target kind, and its
 * checks are the only ones that name `appliesTo: ["cluster"]`. It is registered here
 * like any other because the whole point of the target-kind approach is that the
 * runner, the rubric resolver, the reconciler and both admin screens need to know
 * nothing about it.
 *
 * The profiles are NOT uniformly well served, and each playbook makes the agent find
 * out in its own `dataSources`. RabbitMQ is the sharpest case: a management API may
 * cover one broker of several and an exporter may be absent, so its playbook tells the
 * agent to verify which broker it is talking to and to report levels rather than
 * invent trends.
 * Naming a gap is the profile's job; papering over it would make every run less
 * trustworthy, not more.
 */
export interface TechnologyProfile {
  technology: WorkloadTechnology;
  /**
   * The shipped workload-type TEMPLATE (decision 128): its name and how discovery
   * recognises it. Absent for `kubernetes`, which is the cluster, never a workload.
   * Priorities keep the order the old hard-coded rules had — engines before the
   * generic `node` runtime.
   */
  type?: Omit<WorkloadTypeDraft, "enabled">;
  playbook: Playbook;
  /** The checks this profile's method exists to answer. */
  checks: readonly MonitorCheck[];
}

export const PROFILES: readonly TechnologyProfile[] = Object.freeze([
  {
    technology: "postgresql",
    type: {
      label: "PostgreSQL",
      priority: 40,
      labelValues: ["postgres", "postgresql"],
      // `spilo` and `patroni` are Zalando's PostgreSQL images and carry no other
      // marker — without them the database StatefulSet goes undetected while its
      // exporter and operator get picked up instead.
      patterns: ["postgresql", "postgres", "cloudnative-pg", "timescaledb", "spilo", "patroni"],
    },
    playbook: POSTGRESQL_PLAYBOOK,
    checks: POSTGRESQL_CHECKS,
  },
  {
    technology: "mysql",
    type: {
      label: "MySQL",
      priority: 30,
      labelValues: ["mysql"],
      patterns: ["mysql", "percona-xtradb"],
    },
    playbook: MYSQL_PLAYBOOK,
    checks: MYSQL_CHECKS,
  },
  {
    technology: "mongodb",
    type: {
      label: "MongoDB",
      priority: 50,
      labelValues: ["mongo", "mongodb"],
      patterns: ["mongodb", "mongo"],
    },
    playbook: MONGODB_PLAYBOOK,
    checks: MONGODB_CHECKS,
  },
  {
    technology: "clickhouse",
    type: {
      label: "ClickHouse",
      priority: 20,
      labelValues: ["clickhouse"],
      patterns: ["clickhouse"],
    },
    playbook: CLICKHOUSE_PLAYBOOK,
    checks: CLICKHOUSE_CHECKS,
  },
  {
    technology: "rabbitmq",
    type: {
      label: "RabbitMQ",
      priority: 10,
      labelValues: ["rabbitmq", "rabbit"],
      patterns: ["rabbitmq"],
    },
    playbook: RABBITMQ_PLAYBOOK,
    checks: RABBITMQ_CHECKS,
  },
  {
    technology: "nodejs",
    type: {
      label: "Node.js",
      priority: 0,
      labelValues: ["node", "nodejs"],
      patterns: ["nodejs", "node"],
    },
    playbook: NODEJS_PLAYBOOK,
    checks: NODEJS_CHECKS,
  },
  {
    technology: "kubernetes",
    playbook: KUBERNETES_PLAYBOOK,
    checks: KUBERNETES_CHECKS,
  },
]);


/** Every profile's checks, for seeding into the live rubric. */
export const PROFILE_CHECKS: readonly MonitorCheck[] = Object.freeze(
  PROFILES.flatMap((p) => [...p.checks]),
);
