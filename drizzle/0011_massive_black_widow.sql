ALTER TABLE "monitoring_playbooks" DROP CONSTRAINT "monitoring_playbooks_declined_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" DROP COLUMN "version";--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" DROP COLUMN "declined_shipped_version";--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" DROP COLUMN "declined_by";--> statement-breakpoint
ALTER TABLE "monitoring_playbooks" DROP COLUMN "declined_at";--> statement-breakpoint
ALTER TABLE "monitoring_runs" DROP COLUMN "playbook_versions";