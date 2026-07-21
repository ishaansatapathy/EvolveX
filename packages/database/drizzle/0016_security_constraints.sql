ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "token_version" varchar(20) DEFAULT '0' NOT NULL;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_auth_provider_check"
    CHECK ("auth_provider" IN ('local', 'google'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
    CHECK ("role" IN ('user', 'admin'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "forms" ADD CONSTRAINT "forms_visibility_check"
    CHECK ("visibility" IN ('public', 'unlisted', 'draft'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "forms" ADD CONSTRAINT "forms_theme_check"
    CHECK ("theme" IN ('default', 'ben10', 'anime', 'startup', 'gaming', 'tech'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_type_check"
    CHECK ("type" IN ('text', 'textarea', 'email', 'number', 'date', 'select', 'rating', 'checkbox', 'description'));
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "submissions_form_submitter_unique_idx"
  ON "submissions" ("form_id", "submitter_user_id")
  WHERE "submitter_user_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "submission_responses_submission_field_unique_idx"
  ON "submission_responses" ("submission_id", "field_id");
