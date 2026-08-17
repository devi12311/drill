ALTER TABLE "monitoring_playbooks" ADD COLUMN "declined_shipped_version" integer;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD COLUMN "declined_by" uuid;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD COLUMN "declined_at" timestamp;--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" ADD CONSTRAINT "monitoring_playbooks_declined_by_users_id_fk" FOREIGN KEY ("declined_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;