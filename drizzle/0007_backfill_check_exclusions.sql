-- Backfill `excludes_technologies` on the built-in checks that ship with an
-- exclusion, for databases that already hold those rows.
--
-- Why this is needed: `seedBuiltinChecks` inserts if missing and NEVER updates, so
-- an admin's retune of a built-in survives every restart (decision 54). The
-- flip side is that a new FIELD shipped on an existing built-in has no route into
-- an installed database, and the exclusions below would silently do nothing.
--
-- Why this is safe rather than a violation of that invariant: the column was created
-- empty in 0006, so no operator has ever set it and there is nothing to clobber. The
-- `= '{}'` guard keeps it that way — it is idempotent, and it will not overwrite an
-- exclusion someone set by hand between deploying and migrating.
--
-- Each exclusion exists because the generic check is either a false positive for
-- that engine or is asked better by a technology-specific one; leaving both live
-- would open two concerns for one problem.

-- One replica is the normal shape of a primary database. PG.NO_STANDBY asks the
-- question that actually applies.
UPDATE "monitoring_checks" SET "excludes_technologies" = '{postgresql}'
  WHERE "id" = 'PERF.SINGLE_REPLICA' AND "excludes_technologies" = '{}';--> statement-breakpoint

-- A database is deliberately given more memory than it "uses", because the surplus
-- is its page cache. The right-sizing heuristic reads that as waste.
UPDATE "monitoring_checks" SET "excludes_technologies" = '{postgresql}'
  WHERE "id" = 'PERF.RIGHT_SIZING' AND "excludes_technologies" = '{}';--> statement-breakpoint

-- PG.DISK_RUNWAY asks this plus the growth rate, which is what turns "80% full"
-- into "nine days left".
UPDATE "monitoring_checks" SET "excludes_technologies" = '{postgresql}'
  WHERE "id" = 'PERF.PVC_PRESSURE' AND "excludes_technologies" = '{}';--> statement-breakpoint

-- NODE.OOM_RESTARTS carries the heap-ceiling context that makes an OOM kill
-- actionable on a Node.js service.
UPDATE "monitoring_checks" SET "excludes_technologies" = '{nodejs}'
  WHERE "id" = 'PERF.OOM_KILLS' AND "excludes_technologies" = '{}';--> statement-breakpoint

-- NODE.CPU_THROTTLED explains why throttling hurts a single-threaded runtime more
-- than the generic ratio suggests.
UPDATE "monitoring_checks" SET "excludes_technologies" = '{nodejs}'
  WHERE "id" = 'PERF.CPU_THROTTLING' AND "excludes_technologies" = '{}';
