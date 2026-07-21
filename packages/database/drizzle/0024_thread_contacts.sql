CREATE TABLE IF NOT EXISTS "thread_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120),
	"handle" varchar(80) NOT NULL,
	"source" varchar(20) DEFAULT 'manual' NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "thread_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thread_contacts_user_email_unique" ON "thread_contacts" ("user_id","email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_contacts_user_handle_idx" ON "thread_contacts" ("user_id","handle");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_contacts_user_last_used_idx" ON "thread_contacts" ("user_id","last_used_at");
