CREATE TABLE IF NOT EXISTS "telemetry_sampling_policies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "service_name" varchar(128) NOT NULL,
  "mode" varchar(32) NOT NULL,
  "sample_rate" real NOT NULL,
  "reason" varchar(512) NOT NULL,
  "trigger_source" varchar(64) NOT NULL,
  "investigation_id" uuid,
  "expires_at" timestamp NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE INDEX IF NOT EXISTS "telemetry_sampling_org_service_idx" ON "telemetry_sampling_policies" ("organization_id", "service_name");
CREATE INDEX IF NOT EXISTS "telemetry_sampling_expires_idx" ON "telemetry_sampling_policies" ("expires_at");

CREATE TABLE IF NOT EXISTS "telemetry_intelligence_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "kind" varchar(64) NOT NULL,
  "service_name" varchar(128),
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "telemetry_intelligence_events_org_created_idx" ON "telemetry_intelligence_events" ("organization_id", "created_at" DESC);

ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "telemetry_intelligence" jsonb;
