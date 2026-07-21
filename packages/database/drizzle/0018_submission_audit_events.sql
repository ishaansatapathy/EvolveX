CREATE TABLE IF NOT EXISTS "submission_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_type" varchar(40) NOT NULL,
  "form_id" uuid NOT NULL,
  "submission_id" uuid NOT NULL,
  "actor_user_id" uuid,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "submission_audit_events" ADD CONSTRAINT "submission_audit_events_form_id_forms_id_fk"
    FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "submission_audit_events" ADD CONSTRAINT "submission_audit_events_actor_user_id_users_id_fk"
    FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "submission_audit_events_form_created_idx"
  ON "submission_audit_events" ("form_id", "created_at");

CREATE INDEX IF NOT EXISTS "submission_audit_events_submission_idx"
  ON "submission_audit_events" ("submission_id");
