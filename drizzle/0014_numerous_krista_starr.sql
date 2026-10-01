CREATE TABLE "chat_turn_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"turn_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"model" text NOT NULL,
	"kind" text NOT NULL,
	"request" jsonb NOT NULL,
	"question" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"resumable" boolean DEFAULT true NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"auto_resumes" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp,
	"heartbeat_at" timestamp,
	"cancel_requested_at" timestamp,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_turn_events" ADD CONSTRAINT "chat_turn_events_turn_id_chat_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."chat_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_agent_id_holmes_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."holmes_agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_turn_events_turn_idx" ON "chat_turn_events" USING btree ("turn_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_turns_conversation_idx" ON "chat_turns" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_turns_queue_idx" ON "chat_turns" USING btree ("status","created_at");