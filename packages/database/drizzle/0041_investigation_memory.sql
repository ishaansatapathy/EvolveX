CREATE TABLE IF NOT EXISTS "investigation_memory" (
  "investigation_id" uuid PRIMARY KEY REFERENCES "investigations"("id") ON DELETE CASCADE,
  "organization_id" uuid REFERENCES "organizations"("id") ON DELETE SET NULL,
  "owner_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "symptoms" text NOT NULL,
  "root_cause" text,
  "fix_applied" text,
  "fix_outcome" varchar(32) DEFAULT 'resolved' NOT NULL,
  "duration_ms" integer,
  "impact_summary" text,
  "resolved_at" timestamp DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp
);

CREATE INDEX IF NOT EXISTS "investigation_memory_org_resolved_idx" ON "investigation_memory" ("organization_id", "resolved_at" DESC);
