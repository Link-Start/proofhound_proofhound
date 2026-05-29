-- Add auto_concurrency flag to models: when TRUE (default), concurrency_limit is the ceiling and
-- effective concurrency is auto-tuned by the limiter; when FALSE, concurrency_limit is the hard limit.
-- See docs/specs/21-models.md §6.1
ALTER TABLE "ph_assets"."models" ADD COLUMN "auto_concurrency" boolean DEFAULT true NOT NULL;