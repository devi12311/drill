ALTER TABLE "organizations" ADD COLUMN "answer_mode" text DEFAULT 'brief' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "answer_rules" text;