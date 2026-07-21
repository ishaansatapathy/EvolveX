CREATE TABLE IF NOT EXISTS "thread_mail_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" varchar(64) NOT NULL,
	"thread_id" varchar(128) NOT NULL,
	"history_id" varchar(64),
	"subject" text,
	"from_name" text,
	"from_address" varchar(320),
	"snippet" text,
	"last_message_at" timestamp,
	"message_count" integer DEFAULT 1 NOT NULL,
	"unread" boolean DEFAULT false NOT NULL,
	"label_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thread_mail_cache_user_thread_unique" ON "thread_mail_cache" ("user_id","thread_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_mail_cache_user_recent_idx" ON "thread_mail_cache" ("user_id","last_message_at");
