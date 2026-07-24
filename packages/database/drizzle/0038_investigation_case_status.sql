ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "case_status" varchar(20) DEFAULT 'open' NOT NULL;

ALTER TABLE "investigations" DROP CONSTRAINT IF EXISTS "investigations_case_status_check";
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_case_status_check"
  CHECK ("case_status" in ('open', 'investigating', 'monitoring', 'resolved'));

UPDATE "investigations"
SET "case_status" = 'investigating'
WHERE "status" = 'building' AND "case_status" = 'open';

CREATE INDEX IF NOT EXISTS "investigations_case_status_idx" ON "investigations" ("case_status", "created_at" DESC);
