CREATE TABLE IF NOT EXISTS "investigation_pipeline_cache" (
  "investigation_id" uuid PRIMARY KEY REFERENCES "investigations"("id") ON DELETE CASCADE,
  "pipeline_version" integer NOT NULL,
  "content_fingerprint" varchar(128) NOT NULL,
  "cached_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS "investigation_pipeline_cache_expires_idx" ON "investigation_pipeline_cache" ("expires_at");
