CREATE TABLE "share_link_redemptions" (
	"link_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"target_org_id" uuid NOT NULL,
	"status" text NOT NULL,
	"imported_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_link_redemptions_link_id_user_id_target_org_id_pk" PRIMARY KEY("link_id","user_id","target_org_id")
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"source_id" uuid,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "share_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD COLUMN "imported_from" jsonb;--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "imported_from" jsonb;--> statement-breakpoint
ALTER TABLE "share_link_redemptions" ADD CONSTRAINT "share_link_redemptions_link_id_share_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_redemptions" ADD CONSTRAINT "share_link_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_link_redemptions" ADD CONSTRAINT "share_link_redemptions_target_org_id_organizations_id_fk" FOREIGN KEY ("target_org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_links_org_idx" ON "share_links" USING btree ("org_id");