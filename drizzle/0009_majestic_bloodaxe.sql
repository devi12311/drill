CREATE TABLE "monitoring_playbooks" (
	"technology" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"framing" text NOT NULL,
	"data_sources" text[] DEFAULT '{}' NOT NULL,
	"method" text[] DEFAULT '{}' NOT NULL,
	"observations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"edited_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "expected_observations" jsonb;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD CONSTRAINT "monitoring_playbooks_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;