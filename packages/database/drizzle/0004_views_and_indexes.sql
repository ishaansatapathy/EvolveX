ALTER TABLE "forms" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "submissions_submitted_at_idx" ON "submissions" ("submitted_at");--> statement-breakpoint
CREATE INDEX "submissions_form_id_submitted_at_idx" ON "submissions" ("form_id", "submitted_at");
