CREATE TABLE "org_memberships" (
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "org_memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_clusters" DROP CONSTRAINT "monitoring_clusters_name_unique";--> statement-breakpoint
ALTER TABLE "skills" DROP CONSTRAINT "skills_name_unique";--> statement-breakpoint
ALTER TABLE "holmes_agents" DROP CONSTRAINT "holmes_agents_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "holmes_agents" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "holmes_agents" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "org_id" uuid;--> statement-breakpoint
-- Hand-written backfill (decision 117): an existing install becomes ONE org that
-- every current user joins — platform admins as owners, everyone else as members —
-- and that owns every existing row. A fresh database has nothing to move, so no
-- org is created and the NOT NULLs below hold on empty tables.
INSERT INTO "organizations" ("name")
SELECT 'Default organization'
WHERE EXISTS (SELECT 1 FROM "users")
   OR EXISTS (SELECT 1 FROM "monitoring_clusters")
   OR EXISTS (SELECT 1 FROM "skills")
   OR EXISTS (SELECT 1 FROM "resolution_artifacts");--> statement-breakpoint
INSERT INTO "org_memberships" ("org_id", "user_id", "role")
SELECT o."id", u."id", CASE WHEN u."role" = 'admin' THEN 'owner' ELSE 'member' END
FROM "users" u CROSS JOIN (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1) o;--> statement-breakpoint
UPDATE "chat_turns" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "conversations" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "holmes_agents" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "monitoring_clusters" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "resolution_artifacts" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "skills" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
UPDATE "audit_log" SET "org_id" = (SELECT "id" FROM "organizations" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
ALTER TABLE "chat_turns" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "holmes_agents" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "skills" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_memberships" ADD CONSTRAINT "org_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_memberships_user_idx" ON "org_memberships" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holmes_agents" ADD CONSTRAINT "holmes_agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holmes_agents" ADD CONSTRAINT "holmes_agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ADD CONSTRAINT "monitoring_clusters_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD CONSTRAINT "resolution_artifacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ADD CONSTRAINT "monitoring_clusters_org_name_unique" UNIQUE("org_id","name");--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_org_name_unique" UNIQUE("org_id","name");