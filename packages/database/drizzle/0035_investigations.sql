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
