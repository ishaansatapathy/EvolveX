CREATE TABLE IF NOT EXISTS "agent_chat_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" varchar(64) NOT NULL,
  "messages" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_chat_history_user_id_idx" ON "agent_chat_history" ("user_id");
