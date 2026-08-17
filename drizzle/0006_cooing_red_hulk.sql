CREATE TABLE "monitoring_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_namespace" text NOT NULL,
	"target_name" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"numeric" double precision,
	"unit" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_observations_run_id_target_kind_target_namespace_target_name_key_unique" UNIQUE("run_id","target_kind","target_namespace","target_name","key")
);
--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD COLUMN "applies_to_technologies" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_checks" ADD COLUMN "excludes_technologies" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD COLUMN "depth" text DEFAULT 'posture' NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "playbook_versions" jsonb;--> statement-breakpoint
ALTER TABLE "monitoring_workloads" ADD COLUMN "technology" text;--> statement-breakpoint
ALTER TABLE "monitoring_workloads" ADD COLUMN "technology_reason" text;--> statement-breakpoint
ALTER TABLE "monitoring_workloads" ADD COLUMN "technology_override" text;--> statement-breakpoint
ALTER TABLE "monitoring_observations" ADD CONSTRAINT "monitoring_observations_run_id_monitoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_observations" ADD CONSTRAINT "monitoring_observations_job_id_monitoring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."monitoring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_observations_trend_idx" ON "monitoring_observations" USING btree ("job_id","target_name","key","created_at");