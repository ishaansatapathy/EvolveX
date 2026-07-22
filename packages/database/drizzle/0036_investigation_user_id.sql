ALTER TABLE "investigations" ADD COLUMN IF NOT EXISTS "user_id" uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investigations_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "investigations"
      ADD CONSTRAINT "investigations_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "investigations_user_id_idx" ON "investigations" ("user_id");
