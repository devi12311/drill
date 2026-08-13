CREATE TABLE "monitoring_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"question" text NOT NULL,
	"evidence" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"base_severity" text NOT NULL,
	"applies_to" text[] DEFAULT '{}' NOT NULL,
	"requires" text,
	"resolve_after_absent_runs" integer DEFAULT 1 NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_job_check_overrides" (
	"job_id" uuid NOT NULL,
	"check_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity_override" text,
	CONSTRAINT "monitoring_job_check_overrides_job_id_check_id_pk" PRIMARY KEY("job_id","check_id")
);
--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD CONSTRAINT "monitoring_checks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_job_check_overrides" ADD CONSTRAINT "monitoring_job_check_overrides_job_id_monitoring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."monitoring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_checks_category_idx" ON "monitoring_checks" USING btree ("category","enabled");--> statement-breakpoint
ALTER TABLE "monitoring_concerns" DROP COLUMN "catalogue_version";