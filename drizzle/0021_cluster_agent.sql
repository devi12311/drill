-- Clusters stop carrying their own Holmes URL + key and point at an org agent.
-- Backfill: an existing agent of the same org with the same URL (oldest wins);
-- a cluster with no such agent gets one made from its own credentials. The key
-- is copied as stored — sealed or legacy plaintext, both tables use one format.
ALTER TABLE "monitoring_clusters" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
INSERT INTO "holmes_agents" ("org_id", "user_id", "name", "url", "api_key", "last_validated_at")
SELECT DISTINCT ON (c."org_id", c."holmes_url")
  c."org_id", c."created_by", c."name", c."holmes_url", c."holmes_api_key", c."last_validated_at"
FROM "monitoring_clusters" c
WHERE NOT EXISTS (
  SELECT 1 FROM "holmes_agents" a WHERE a."org_id" = c."org_id" AND a."url" = c."holmes_url"
)
ORDER BY c."org_id", c."holmes_url", c."created_at";--> statement-breakpoint
UPDATE "monitoring_clusters" c SET "agent_id" = (
  SELECT a."id" FROM "holmes_agents" a
  WHERE a."org_id" = c."org_id" AND a."url" = c."holmes_url"
  ORDER BY a."created_at" LIMIT 1
);--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ALTER COLUMN "agent_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ADD CONSTRAINT "monitoring_clusters_agent_id_holmes_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."holmes_agents"("id") ON DELETE no action ON UPDATE no action;
