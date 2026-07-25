CREATE TABLE IF NOT EXISTS "telemetry_service_error_summary_mv" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "service_name" varchar(128) NOT NULL,
  "window_start" timestamp NOT NULL,
  "request_count" integer DEFAULT 0 NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "p99_ms" real,
  "refreshed_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "telemetry_service_error_summary_mv_unique"
  ON "telemetry_service_error_summary_mv" ("organization_id", "service_name", "window_start");

CREATE INDEX IF NOT EXISTS "telemetry_service_error_summary_org_service_window_idx"
  ON "telemetry_service_error_summary_mv" ("organization_id", "service_name", "window_start" DESC);

CREATE TABLE IF NOT EXISTS "telemetry_top_failing_endpoints_mv" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE CASCADE,
  "service_name" varchar(128) NOT NULL,
  "endpoint" varchar(512) NOT NULL,
  "window_start" timestamp NOT NULL,
  "error_count" integer DEFAULT 0 NOT NULL,
  "p99_ms" real,
  "refreshed_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "telemetry_top_failing_endpoints_mv_unique"
  ON "telemetry_top_failing_endpoints_mv" ("organization_id", "service_name", "endpoint", "window_start");

CREATE INDEX IF NOT EXISTS "telemetry_top_failing_endpoints_org_service_window_idx"
  ON "telemetry_top_failing_endpoints_mv" ("organization_id", "service_name", "window_start" DESC);
