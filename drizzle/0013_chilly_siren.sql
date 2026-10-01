CREATE TABLE "monitoring_run_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"targets" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" jsonb,
	"failed_meta" jsonb,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	CONSTRAINT "monitoring_run_targets_run_id_position_unique" UNIQUE("run_id","position")
);
--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "heartbeat_at" timestamp;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "cancel_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "rubric_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "monitoring_run_targets" ADD CONSTRAINT "monitoring_run_targets_run_id_monitoring_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."monitoring_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;