CREATE TABLE "monitoring_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kubeconfig" text NOT NULL,
	"holmes_url" text NOT NULL,
	"holmes_api_key" text NOT NULL,
	"created_by" uuid,
	"last_validated_at" timestamp,
	"last_discovered_at" timestamp,
	"discovery_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_clusters_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "monitoring_concerns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"check_id" text NOT NULL,
	"catalogue_version" integer NOT NULL,
	"category" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_namespace" text NOT NULL,
	"target_name" text NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"base_severity" text NOT NULL,
	"effective_severity" text NOT NULL,
	"severity_rationale" text,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"rationale" text NOT NULL,
	"remediation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_resolved_at" timestamp,
	"severity_changed_at" timestamp,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"consecutive_runs_absent" integer DEFAULT 0 NOT NULL,
	"first_seen_run_id" uuid,
	"last_seen_run_id" uuid,
	"dismissal_reason" text,
	"dismissal_comment" text,
	"dismissed_by" uuid,
	"muted_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_concerns_job_id_fingerprint_unique" UNIQUE("job_id","fingerprint")
);
--> statement-breakpoint
CREATE TABLE "monitoring_job_targets" (
	"job_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "monitoring_job_targets_job_id_kind_namespace_name_pk" PRIMARY KEY("job_id","kind","namespace","name")
);
--> statement-breakpoint
CREATE TABLE "monitoring_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"model" text NOT NULL,
	"schedule" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_run_findings" (
	"run_id" uuid NOT NULL,
	"concern_id" uuid NOT NULL,
	"severity" text NOT NULL,
	"is_new" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_run_findings_run_id_concern_id_pk" PRIMARY KEY("run_id","concern_id")
);
--> statement-breakpoint
CREATE TABLE "monitoring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by" uuid,
	"claimed_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"attempt" integer DEFAULT 0 NOT NULL,
	"model" text,
	"cost_usd" real,
	"total_tokens" integer,
	"duration_ms" integer,
	"tool_calls_total" integer,
	"tool_calls_failed" integer,
	"coverage" jsonb,
	"rejected" jsonb,
	"raw_response" jsonb,
	"error" text,
	"findings_new" integer,
	"findings_resolved" integer,
	"findings_open" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monitoring_workloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"replicas" integer,
	"images" text[] DEFAULT '{}' NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_workloads_cluster_id_kind_namespace_name_unique" UNIQUE("cluster_id","kind","namespace","name")
);
--> statement-breakpoint
ALTER TABLE "monitoring_clusters" ADD CONSTRAINT "monitoring_clusters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_concerns" ADD CONSTRAINT "monitoring_concerns_job_id_monitoring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."monitoring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_concerns" ADD CONSTRAINT "monitoring_concerns_first_seen_run_id_monitoring_runs_id_fk" FOREIGN KEY ("first_seen_run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_concerns" ADD CONSTRAINT "monitoring_concerns_last_seen_run_id_monitoring_runs_id_fk" FOREIGN KEY ("last_seen_run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_concerns" ADD CONSTRAINT "monitoring_concerns_dismissed_by_users_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_job_targets" ADD CONSTRAINT "monitoring_job_targets_job_id_monitoring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."monitoring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD CONSTRAINT "monitoring_jobs_cluster_id_monitoring_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."monitoring_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_jobs" ADD CONSTRAINT "monitoring_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_run_findings" ADD CONSTRAINT "monitoring_run_findings_run_id_monitoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_run_findings" ADD CONSTRAINT "monitoring_run_findings_concern_id_monitoring_concerns_id_fk" FOREIGN KEY ("concern_id") REFERENCES "public"."monitoring_concerns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_job_id_monitoring_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."monitoring_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_workloads" ADD CONSTRAINT "monitoring_workloads_cluster_id_monitoring_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."monitoring_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "monitoring_concerns_job_status_idx" ON "monitoring_concerns" USING btree ("job_id","status");--> statement-breakpoint
CREATE INDEX "monitoring_jobs_cluster_idx" ON "monitoring_jobs" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "monitoring_jobs_due_idx" ON "monitoring_jobs" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "monitoring_runs_queue_idx" ON "monitoring_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "monitoring_runs_job_idx" ON "monitoring_runs" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "monitoring_workloads_cluster_idx" ON "monitoring_workloads" USING btree ("cluster_id","namespace");