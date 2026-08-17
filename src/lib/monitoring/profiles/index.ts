import type { MonitorCheck } from "../catalogue";
import type { Playbook } from "../playbook";
import type { WorkloadTechnology } from "../types";
import { CLICKHOUSE_CHECKS, CLICKHOUSE_PLAYBOOK } from "./clickhouse";
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
 * file is what a fresh database is filled from, and what "revert to shipped"
 * restores — which is why the text stays here, in git, where it can be reviewed and
 * can cite its sources.
 *
 * All six technologies in `WORKLOAD_TECHNOLOGIES` now have a profile. Kafka and
 * ksqlDB deliberately are not in that vocabulary at all: neither has a Holmes toolset
 * or a Prometheus exporter in this cluster, and Kafka's binary protocol defeats the
 * bash/curl fallback entirely — a profile without data produces confident nonsense
 * rather than an assessment, so the plumbing is the prerequisite, not the code.
 *
 * The profiles are NOT uniformly well served, and each playbook says so in its own
 * `dataSources`. RabbitMQ is the sharpest case: its management API covers one broker
 * of several here and there is no exporter at all, so its playbook tells the agent to
 * verify which broker it is talking to and to report levels rather than invent trends.
 * Naming a gap is the profile's job; papering over it would make every run less
 * trustworthy, not more.
 */
export interface TechnologyProfile {
  technology: WorkloadTechnology;
  playbook: Playbook;
  /** The checks this profile's method exists to answer. */
  checks: readonly MonitorCheck[];
}

export const PROFILES: readonly TechnologyProfile[] = Object.freeze([
  {
    technology: "postgresql",
    playbook: POSTGRESQL_PLAYBOOK,
    checks: POSTGRESQL_CHECKS,
  },
  { technology: "mysql", playbook: MYSQL_PLAYBOOK, checks: MYSQL_CHECKS },
  { technology: "mongodb", playbook: MONGODB_PLAYBOOK, checks: MONGODB_CHECKS },
  {
    technology: "clickhouse",
    playbook: CLICKHOUSE_PLAYBOOK,
    checks: CLICKHOUSE_CHECKS,
  },
  {
    technology: "rabbitmq",
    playbook: RABBITMQ_PLAYBOOK,
    checks: RABBITMQ_CHECKS,
  },
  { technology: "nodejs", playbook: NODEJS_PLAYBOOK, checks: NODEJS_CHECKS },
]);

/**
 * Technologies that can actually be assessed deeply today.
 *
 * Read from the code registry rather than from the live table, and that is correct
 * rather than a shortcut: a playbook can be edited but never created or deleted, so
 * the SET of profiled technologies is fixed by what this release ships even though
 * the text of each method is not. It also keeps the workload inventory query free
 * of a dependency on the playbook reader.
 */
export const PROFILED_TECHNOLOGIES: readonly WorkloadTechnology[] =
  Object.freeze(PROFILES.map((p) => p.technology));

/** Every profile's checks, for seeding into the live rubric. */
export const PROFILE_CHECKS: readonly MonitorCheck[] = Object.freeze(
  PROFILES.flatMap((p) => [...p.checks]),
);
