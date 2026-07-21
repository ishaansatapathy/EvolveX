-- Persist the latest Gmail historyId per tenant so incremental webhook sync
-- survives server restarts (previously only in-process Map).
CREATE TABLE IF NOT EXISTS "thread_gmail_state" (
  "user_id" uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "history_id" varchar(64),
  "updated_at" timestamp DEFAULT now()
);
