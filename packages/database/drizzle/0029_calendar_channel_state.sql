CREATE TABLE IF NOT EXISTS "thread_calendar_state" (
  "user_id" varchar(64) PRIMARY KEY NOT NULL,
  "channel_id" varchar(256) NOT NULL,
  "resource_id" varchar(256),
  "expiration" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
