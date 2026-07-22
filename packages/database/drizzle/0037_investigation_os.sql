-- Investigation OS: normalized evidence graph (PostgreSQL + JSONB)

ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "incident_id" varchar(32);
ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "primary_service" varchar(128);
ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "summary" text;
ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "started_at" timestamp;
ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "completed_at" timestamp;

ALTER TABLE "investigation_timeline_entries" ADD COLUMN IF NOT EXISTS "source" varchar(64);

CREATE TABLE IF NOT EXISTS "change_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "investigation_id" uuid REFERENCES "investigations"("id") ON DELETE cascade,
  "type" varchar(32) NOT NULL,
  "service" varchar(128),
  "author" varchar(128),
  "occurred_at" timestamp NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "runtime_signals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "investigation_id" uuid NOT NULL REFERENCES "investigations"("id") ON DELETE cascade,
  "trace_id" varchar(64),
  "service" varchar(128),
  "metric" varchar(128),
  "latency_ms" integer,
  "p95_ms" integer,
  "p99_ms" integer,
  "error_rate" numeric(8, 4),
  "signal_timestamp" timestamp NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "investigation_id" uuid NOT NULL REFERENCES "investigations"("id") ON DELETE cascade,
  "timeline_entry_id" uuid REFERENCES "investigation_timeline_entries"("id") ON DELETE set null,
  "type" varchar(32) NOT NULL,
  "url" varchar(512),
  "confidence" numeric(5, 2),
  "description" text NOT NULL,
  "occurred_at" timestamp NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(128) NOT NULL UNIQUE,
  "healthy" boolean DEFAULT true NOT NULL,
  "latency_ms" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE TABLE IF NOT EXISTS "service_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE cascade,
  "destination_service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE cascade,
  "healthy" boolean DEFAULT true NOT NULL,
  "latency_ms" integer,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "investigation_notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "investigation_id" uuid NOT NULL REFERENCES "investigations"("id") ON DELETE cascade,
  "user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE TABLE IF NOT EXISTS "investigation_summaries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "investigation_id" uuid NOT NULL REFERENCES "investigations"("id") ON DELETE cascade,
  "markdown" text NOT NULL,
  "generated_at" timestamp DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "change_events_investigation_idx" ON "change_events" ("investigation_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "change_events_service_idx" ON "change_events" ("service", "occurred_at");
CREATE INDEX IF NOT EXISTS "runtime_signals_investigation_idx" ON "runtime_signals" ("investigation_id", "signal_timestamp");
CREATE INDEX IF NOT EXISTS "evidence_investigation_idx" ON "evidence" ("investigation_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "evidence_type_idx" ON "evidence" ("investigation_id", "type");
CREATE INDEX IF NOT EXISTS "service_dependencies_edge_idx" ON "service_dependencies" ("source_service_id", "destination_service_id");
CREATE INDEX IF NOT EXISTS "investigation_notes_investigation_idx" ON "investigation_notes" ("investigation_id", "created_at");
CREATE INDEX IF NOT EXISTS "investigation_summaries_investigation_idx" ON "investigation_summaries" ("investigation_id", "generated_at");
CREATE INDEX IF NOT EXISTS "investigations_incident_id_idx" ON "investigations" ("incident_id");

-- Full-text search on timeline descriptions (investigation UI search)
CREATE INDEX IF NOT EXISTS "investigation_timeline_detail_fts_idx"
  ON "investigation_timeline_entries"
  USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("detail", '')));
