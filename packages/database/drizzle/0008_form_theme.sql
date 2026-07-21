ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "theme" varchar(30) DEFAULT 'default' NOT NULL;
