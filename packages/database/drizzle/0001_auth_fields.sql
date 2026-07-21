ALTER TABLE "users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "auth_provider" varchar(20) DEFAULT 'local' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "provider_id" varchar(255);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "verification_token" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_token" varchar(64);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_otp" varchar(6);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_password_expire" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_otp" varchar(6);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "two_factor_otp_expire" timestamp;
