CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "resolution_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid,
	"created_by" uuid NOT NULL,
	"last_edited_by" uuid,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"root_cause" text NOT NULL,
	"symptoms" text[] NOT NULL,
	"affected_services" text[] NOT NULL,
	"tags" text[] NOT NULL,
	"resolution_steps" jsonb NOT NULL,
	"verification_steps" jsonb NOT NULL,
	"graph" jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "resolution_artifacts_conversation_id_unique" UNIQUE("conversation_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "status" text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD CONSTRAINT "resolution_artifacts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD CONSTRAINT "resolution_artifacts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD CONSTRAINT "resolution_artifacts_last_edited_by_users_id_fk" FOREIGN KEY ("last_edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION f_arr2text(text[]) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE
	AS $$ SELECT array_to_string($1, ' ') $$;--> statement-breakpoint
ALTER TABLE "resolution_artifacts" ADD COLUMN "search_vector" tsvector
	GENERATED ALWAYS AS (
		setweight(to_tsvector('english', coalesce("title", '')), 'A') ||
		setweight(to_tsvector('simple', f_arr2text("symptoms")), 'A') ||
		setweight(to_tsvector('simple', f_arr2text("affected_services") || ' ' || f_arr2text("tags")), 'B') ||
		setweight(to_tsvector('english', coalesce("summary", '')), 'B') ||
		setweight(to_tsvector('english', coalesce("root_cause", '')), 'C')
	) STORED;--> statement-breakpoint
CREATE INDEX "resolution_artifacts_fts_idx" ON "resolution_artifacts" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "resolution_artifacts_trgm_idx" ON "resolution_artifacts" USING gin (("title" || ' ' || f_arr2text("affected_services") || ' ' || f_arr2text("symptoms")) gin_trgm_ops);
