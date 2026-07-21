-- Fix agent_chat_history.user_id: varchar(64) → uuid with FK → users.id
-- Drops unique index, clears orphaned rows, alters type, re-adds index + FK.

ALTER TABLE "agent_chat_history"
  DROP CONSTRAINT IF EXISTS "agent_chat_history_user_id_fkey";

DROP INDEX IF EXISTS "agent_chat_history_user_id_idx";

DELETE FROM "agent_chat_history"
WHERE "user_id" NOT IN (
  SELECT id::text FROM "users"
);

ALTER TABLE "agent_chat_history"
  ALTER COLUMN "user_id" TYPE uuid USING "user_id"::uuid;

ALTER TABLE "agent_chat_history"
  ADD CONSTRAINT "agent_chat_history_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_chat_history_user_id_idx"
  ON "agent_chat_history" ("user_id");
