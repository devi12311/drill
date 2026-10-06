-- The key columns stop being primary keys (decision 126): one row per org now.
ALTER TABLE "monitoring_checks" DROP CONSTRAINT "monitoring_checks_pkey";--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" DROP CONSTRAINT "monitoring_playbooks_pkey";--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD COLUMN "uid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD COLUMN "based_on_version" integer;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD COLUMN "uid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD COLUMN "based_on_version" integer;--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD CONSTRAINT "monitoring_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD CONSTRAINT "monitoring_playbooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD CONSTRAINT "monitoring_checks_org_key_unique" UNIQUE NULLS NOT DISTINCT("org_id","id");--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD CONSTRAINT "monitoring_playbooks_org_technology_unique" UNIQUE NULLS NOT DISTINCT("org_id","technology");--> statement-breakpoint
-- Hand-written (decision 126): a custom check was written by the one team that used
-- this install, for its own cluster — it becomes that org's own check, not a
-- template every future org would inherit. Built-ins and playbooks stay templates.
UPDATE "monitoring_checks" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1)
WHERE "builtin" = false;
