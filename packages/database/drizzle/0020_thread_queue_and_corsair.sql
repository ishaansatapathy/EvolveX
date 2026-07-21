CREATE TABLE IF NOT EXISTS "corsair_integrations" (
  "id" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "name" text NOT NULL,
  "config" jsonb NOT NULL DEFAULT '{}',
  "dek" text
);

CREATE TABLE IF NOT EXISTS "corsair_accounts" (
  "id" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "tenant_id" text NOT NULL,
  "integration_id" text NOT NULL REFERENCES "corsair_integrations"("id"),
  "config" jsonb NOT NULL DEFAULT '{}',
  "dek" text
);

CREATE TABLE IF NOT EXISTS "corsair_entities" (
  "id" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "account_id" text NOT NULL REFERENCES "corsair_accounts"("id"),
  "entity_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "version" text NOT NULL,
  "data" jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS "corsair_events" (
  "id" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "account_id" text NOT NULL REFERENCES "corsair_accounts"("id"),
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "status" text
);

CREATE TABLE IF NOT EXISTS "corsair_permissions" (
  "id" text PRIMARY KEY,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "token" text NOT NULL,
  "plugin" text NOT NULL,
  "endpoint" text NOT NULL,
  "args" text NOT NULL,
  "tenant_id" text NOT NULL DEFAULT 'default',
  "status" text NOT NULL DEFAULT 'pending',
  "expires_at" text NOT NULL,
  "error" text
);

CREATE TABLE IF NOT EXISTS "thread_queue_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind" varchar(32) NOT NULL,
  "title" varchar(200) NOT NULL,
  "preview" text,
  "payload" jsonb NOT NULL DEFAULT '{}',
  "source_thread_id" varchar(128),
  "status" varchar(20) NOT NULL DEFAULT 'pending',
  "error_message" text,
  "created_at" timestamp DEFAULT now(),
  "resolved_at" timestamp,
  CONSTRAINT "thread_queue_items_kind_check" CHECK ("kind" IN ('email_send', 'email_draft', 'calendar_invite', 'meeting_bundle', 'calendar_archive')),
  CONSTRAINT "thread_queue_items_status_check" CHECK ("status" IN ('pending', 'approved', 'dismissed', 'failed'))
);

CREATE INDEX IF NOT EXISTS "thread_queue_user_status_idx"
  ON "thread_queue_items" ("user_id", "status", "created_at" DESC);
