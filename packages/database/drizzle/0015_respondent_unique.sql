-- Enforce one anonymous response per form when respondent_key is present
CREATE UNIQUE INDEX IF NOT EXISTS "submissions_form_respondent_unique_idx"
  ON "submissions" ("form_id", "respondent_key")
  WHERE "respondent_key" IS NOT NULL;
