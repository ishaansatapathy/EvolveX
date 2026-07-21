ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "allow_multiple_submissions" boolean DEFAULT true NOT NULL;
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "respondent_key" varchar(64);
CREATE INDEX IF NOT EXISTS "submissions_form_respondent_idx" ON "submissions" ("form_id", "respondent_key");
