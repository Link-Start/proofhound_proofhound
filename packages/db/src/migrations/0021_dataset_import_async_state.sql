-- Server-side asynchronous dataset raw import state machine.
-- Existing importing sessions are legacy client-streamed sessions, so they are mapped to uploading.
ALTER TABLE "ph_assets"."dataset_imports" DROP CONSTRAINT IF EXISTS "dataset_imports_source_format_check";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" DROP CONSTRAINT IF EXISTS "dataset_imports_status_check";--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ALTER COLUMN "status" SET DEFAULT 'created';--> statement-breakpoint
UPDATE "ph_assets"."dataset_imports" SET "status" = 'completed' WHERE "status" = 'ready';--> statement-breakpoint
UPDATE "ph_assets"."dataset_imports" SET "status" = 'uploading' WHERE "status" = 'importing';--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "raw_upload_completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "job_id" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "error_code" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "error_message" text;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD COLUMN IF NOT EXISTS "aborted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_source_format_check" CHECK ("source_format" IN ('jsonl', 'csv', 'tsv', 'json', 'zip'));--> statement-breakpoint
ALTER TABLE "ph_assets"."dataset_imports" ADD CONSTRAINT "dataset_imports_status_check" CHECK ("status" IN ('created', 'uploading', 'uploaded', 'queued', 'parsing', 'importing', 'completed', 'failed', 'aborted'));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dataset_imports_job_id" ON "ph_assets"."dataset_imports" USING btree ("job_id") WHERE "job_id" IS NOT NULL;
