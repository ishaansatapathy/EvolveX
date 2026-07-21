ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "role" varchar(20) DEFAULT 'user' NOT NULL;

UPDATE "users" SET "role" = 'admin' WHERE "email" = 'demo@chaiform.dev' AND "role" = 'user';
