CREATE TABLE IF NOT EXISTS "form_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "form_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "schema_snapshot" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_forms_id_fk"
    FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "form_versions_form_version_unique"
  ON "form_versions" ("form_id", "version_number");

ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "current_version_id" uuid;

ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "form_version_id" uuid;
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "idempotency_key" varchar(64);

CREATE INDEX IF NOT EXISTS "submissions_form_version_idx" ON "submissions" ("form_version_id");
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_form_idempotency_idx"
  ON "submissions" ("form_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "forms_deleted_at_idx" ON "forms" ("deleted_at");

-- Backfill version 1 for existing forms
INSERT INTO "form_versions" ("form_id", "version_number", "schema_snapshot")
SELECT
  f.id,
  1,
  COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ff.id,
          'label', ff.label,
          'type', ff.type,
          'required', ff.required,
          'config', COALESCE(ff.config, '{}'::jsonb)
        )
        ORDER BY ff.sort_order
      )
      FROM "form_fields" ff
      WHERE ff.form_id = f.id
    ),
    '[]'::jsonb
  )
FROM "forms" f
WHERE NOT EXISTS (
  SELECT 1 FROM "form_versions" fv WHERE fv.form_id = f.id AND fv.version_number = 1
);

UPDATE "forms" f
SET "current_version_id" = fv.id
FROM "form_versions" fv
WHERE fv.form_id = f.id
  AND fv.version_number = 1
  AND f."current_version_id" IS NULL;

UPDATE "submissions" s
SET "form_version_id" = f."current_version_id"
FROM "forms" f
WHERE s.form_id = f.id
  AND s."form_version_id" IS NULL
  AND f."current_version_id" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "forms" ADD CONSTRAINT "forms_current_version_id_form_versions_id_fk"
    FOREIGN KEY ("current_version_id") REFERENCES "public"."form_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_version_id_form_versions_id_fk"
    FOREIGN KEY ("form_version_id") REFERENCES "public"."form_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
