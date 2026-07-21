CREATE TABLE IF NOT EXISTS "agent_chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" varchar(120),
  "messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tool_memory" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "focus_thread_id" varchar(128),
  "focus_event_id" varchar(256),
  "focus_thread_label" varchar(200),
  "focus_event_label" varchar(200),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "agent_chat_sessions_user_updated_idx"
  ON "agent_chat_sessions" ("user_id", "updated_at" DESC);
