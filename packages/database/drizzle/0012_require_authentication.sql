ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "require_authentication" boolean DEFAULT false NOT NULL;
ALTER TABLE "submissions" ADD COLUMN IF NOT EXISTS "submitter_user_id" uuid;
DO $$ BEGIN
  ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitter_user_id_users_id_fk"
    FOREIGN KEY ("submitter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "submissions_form_submitter_idx" ON "submissions" ("form_id", "submitter_user_id");
