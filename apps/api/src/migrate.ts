import { runJournalMigrations } from "@repo/database/migrate";
import { createPgClient, getMigrationDatabaseUrl } from "@repo/database/pg";

/**
 * Idempotent safety patches applied after journal migrations. Kept intentionally
 * small: only the auth columns Thread actually relies on. Schema for queues,
 * Corsair and the mail cache lives in versioned drizzle migrations.
 */
const ENSURE_SCHEMA_SQL = `
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'user' NOT NULL;
ALTER TABLE "users" ALTER COLUMN "reset_password_otp" TYPE varchar(64);
ALTER TABLE "users" ALTER COLUMN "two_factor_otp" TYPE varchar(64);

-- Idempotent: create brief_dismissals if the drizzle journal migration hasn't run yet.
CREATE TABLE IF NOT EXISTS brief_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  dismissed_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS brief_dismissals_user_thread_idx ON brief_dismissals (user_id, thread_id);

-- Brief daily cache — one row per user per date.
CREATE TABLE IF NOT EXISTS brief_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date_key text NOT NULL,
  brief_json text NOT NULL,
  generated_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS brief_cache_user_date_idx ON brief_cache (user_id, date_key);

-- Queue kind: draft_send (send existing Gmail draft via HITL).
ALTER TABLE "thread_queue_items" DROP CONSTRAINT IF EXISTS "thread_queue_items_kind_check";
ALTER TABLE "thread_queue_items" ADD CONSTRAINT "thread_queue_items_kind_check" CHECK ("kind" IN ('email_send', 'email_draft', 'draft_send', 'calendar_invite', 'meeting_bundle', 'calendar_archive', 'calendar_delete', 'calendar_update'));

CREATE TABLE IF NOT EXISTS "investigations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "external_id" varchar(128),
  "title" varchar(255) NOT NULL,
  "status" varchar(20) DEFAULT 'building' NOT NULL,
  "severity" varchar(32),
  "alert_name" varchar(255),
  "affected_services" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "incident_window_start" timestamp,
  "incident_window_end" timestamp,
  "signoz_alert_payload" jsonb,
  "investigation_context" jsonb,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp,
  CONSTRAINT "investigations_status_check" CHECK ("status" in ('building', 'ready', 'failed'))
);

CREATE TABLE IF NOT EXISTS "investigation_timeline_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "investigation_id" uuid NOT NULL REFERENCES "investigations"("id") ON DELETE cascade,
  "occurred_at" timestamp NOT NULL,
  "kind" varchar(20) NOT NULL,
  "title" varchar(255) NOT NULL,
  "detail" text NOT NULL,
  "source_ref" jsonb,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "investigations_status_created_idx" ON "investigations" ("status", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "investigations_external_id_idx" ON "investigations" ("external_id");
CREATE INDEX IF NOT EXISTS "investigation_timeline_investigation_idx" ON "investigation_timeline_entries" ("investigation_id", "sort_order");

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" varchar(64) NOT NULL,
  "resource_type" varchar(64) NOT NULL,
  "resource_id" varchar(128),
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "audit_events_created_idx" ON "audit_events" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "audit_events_resource_idx" ON "audit_events" ("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "audit_events_actor_idx" ON "audit_events" ("actor_user_id", "created_at" DESC);
`;

export async function runMigrations() {
  const databaseUrl = getMigrationDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  // Journal migrations may fail on existing DBs where tables were created
  // incrementally but the drizzle journal is out of sync. Never crash the
  // server for that — fall through to idempotent ENSURE_SCHEMA_SQL patches.
  try {
    await runJournalMigrations(databaseUrl);
  } catch (err) {
    console.warn(
      "[migrate] Drizzle journal migrations skipped:",
      err instanceof Error ? err.message : String(err),
    );
  }

  const client = await createPgClient(databaseUrl);
  try {
    await client.query(ENSURE_SCHEMA_SQL);
  } finally {
    await client.end();
  }
}
