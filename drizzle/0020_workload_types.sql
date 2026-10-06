CREATE TABLE "monitoring_workload_types" (
	"uid" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"label_values" text[] DEFAULT '{}' NOT NULL,
	"patterns" text[] DEFAULT '{}' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"based_on_version" integer,
	"edited_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_workload_types_org_slug_unique" UNIQUE NULLS NOT DISTINCT("org_id","slug")
);
--> statement-breakpoint
ALTER TABLE "monitoring_workload_types" ADD CONSTRAINT "monitoring_workload_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_workload_types" ADD CONSTRAINT "monitoring_workload_types_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Hand-written (decision 128): the first install named every in-house Node.js
-- service `ms-<name>` (image, repo and trace service alike), and those images carry
-- no runtime marker — the convention was a hard-coded rule in technology.ts. It is
-- that org's knowledge, so it becomes that org's copy of the Node.js type, with a
-- priority above every shipped engine so `ms-postgres-sync` is still a service and
-- not a database. Templates are seeded at runtime; based_on_version 1 matches the
-- first template version, so the copy is not flagged. No org (fresh install): no row.
INSERT INTO "monitoring_workload_types"
  ("org_id", "slug", "label", "priority", "label_values", "patterns", "builtin", "based_on_version")
SELECT "id", 'nodejs', 'Node.js', 60, ARRAY['node', 'nodejs'], ARRAY['ms', 'nodejs', 'node'], true, 1
FROM "organizations" ORDER BY "created_at" LIMIT 1;
