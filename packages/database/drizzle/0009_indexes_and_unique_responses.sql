CREATE INDEX IF NOT EXISTS "form_fields_form_id_idx" ON "form_fields" ("form_id");

CREATE UNIQUE INDEX IF NOT EXISTS "submission_responses_submission_field_unique"
  ON "submission_responses" ("submission_id", "field_id");
