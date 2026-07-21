ALTER TABLE "forms" ADD COLUMN "slug" varchar(80);--> statement-breakpoint
CREATE UNIQUE INDEX "forms_slug_unique" ON "forms" ("slug") WHERE "slug" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "forms_user_id_idx" ON "forms" ("user_id");--> statement-breakpoint
CREATE INDEX "submissions_form_id_idx" ON "submissions" ("form_id");--> statement-breakpoint
CREATE TABLE "form_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"label" varchar(255) NOT NULL,
	"type" varchar(20) NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"sort_order" integer NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
CREATE TABLE "submission_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value" text NOT NULL
);--> statement-breakpoint
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_responses" ADD CONSTRAINT "submission_responses_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_responses" ADD CONSTRAINT "submission_responses_field_id_form_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."form_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_responses_submission_id_idx" ON "submission_responses" ("submission_id");
