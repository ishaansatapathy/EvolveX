ALTER TABLE "thread_queue_items" DROP CONSTRAINT IF EXISTS "thread_queue_items_status_check";
--> statement-breakpoint
ALTER TABLE "thread_queue_items" ADD CONSTRAINT "thread_queue_items_status_check" CHECK ("status" IN ('pending', 'processing', 'approved', 'dismissed', 'failed'));
--> statement-breakpoint
ALTER TABLE "thread_queue_items" ADD COLUMN IF NOT EXISTS "processing_at" timestamp;
