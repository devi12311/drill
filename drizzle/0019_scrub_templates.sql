-- Decision 127: the shipped templates become generic, and what was specific to the
-- first install moves into THAT org's own copies — so its assessments read exactly
-- the text they read before, while every other org inherits the generic method.
-- The "original org" is the oldest one (the backfill of 0016); on a fresh database
-- there is none and the copies below insert nothing.

-- 1. Copy every playbook template, as it stands, into the original org (unless it
--    already has its own copy). based_on_version is the template's current version,
--    so the refresh in step 2 marks each copy "template updated" — accurate, and
--    "Keep my version" clears it.
INSERT INTO "monitoring_playbooks"
  ("org_id", "technology", "framing", "data_sources", "method", "observations",
   "edited_by", "version", "based_on_version")
SELECT o."id", t."technology", t."framing", t."data_sources", t."method", t."observations",
       t."edited_by", 1, t."version"
FROM "monitoring_playbooks" t
CROSS JOIN (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1) o
WHERE t."org_id" IS NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 2. Hand the templates back to the seed: an un-edited template is refreshed from
--    git on the next boot (seedPlaybooks), with a version bump because the text
--    changed. A platform admin's earlier template edit survives in the copy above.
UPDATE "monitoring_playbooks" SET "edited_by" = NULL WHERE "org_id" IS NULL;
--> statement-breakpoint
-- 3. The four checks whose shipped wording or citations were install-specific:
--    copy each into the original org with its CURRENT version (so concerns keep
--    their version lineage) and based_on_version 0, which flags it against the
--    re-seeded template.
INSERT INTO "monitoring_checks"
  ("org_id", "id", "category", "title", "question", "evidence", "reference",
   "base_severity", "applies_to", "applies_to_technologies", "excludes_technologies",
   "requires", "resolve_after_absent_runs", "builtin", "enabled", "version",
   "based_on_version", "created_by")
SELECT o."id", t."id", t."category", t."title", t."question", t."evidence", t."reference",
       t."base_severity", t."applies_to", t."applies_to_technologies", t."excludes_technologies",
       t."requires", t."resolve_after_absent_runs", t."builtin", t."enabled", t."version",
       0, t."created_by"
FROM "monitoring_checks" t
CROSS JOIN (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1) o
WHERE t."org_id" IS NULL
  AND t."id" IN ('K8S.OBSERVABILITY_GAPS', 'K8S.NODE_HETEROGENEITY',
                 'K8S.CNI_DATAPLANE_HEALTH', 'RABBIT.QUEUE_DEPTH_HIGH')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- 4. Drop those built-in templates; the insert-only check seed re-creates them from
--    the generic text on the next boot. (Check templates are never refreshed in place
--    — decision 54 — so a delete-and-reseed is the only way new wording reaches them.)
DELETE FROM "monitoring_checks"
WHERE "org_id" IS NULL AND "builtin" = true
  AND "id" IN ('K8S.OBSERVABILITY_GAPS', 'K8S.NODE_HETEROGENEITY',
               'K8S.CNI_DATAPLANE_HEALTH', 'RABBIT.QUEUE_DEPTH_HIGH');
