-- Webhook token migration: switch to scope='webhook' + forward link via connector_id
-- See docs/specs/06-database-schema.md §3.2 / §4.5
--
-- Order:
--   a) Add the connector_id column to api_tokens
--   b) Backfill api_tokens.connector_id from connectors.webhook_token_id and upgrade scope to 'webhook'
--   c) Drop the legacy connectors.webhook_token_id FK + column
--   d) Upgrade api_tokens' scope CHECK and scope_fields CHECK
--   e) Add the connector_id FK + partial index
ALTER TABLE "ph_core"."api_tokens" ADD COLUMN "connector_id" uuid;--> statement-breakpoint
UPDATE "ph_core"."api_tokens" AS t
SET scope = 'webhook',
    connector_id = c.id
FROM "ph_assets"."connectors" AS c
WHERE c.webhook_token_id = t.id
  AND c.deleted_at IS NULL;--> statement-breakpoint
ALTER TABLE "ph_assets"."connectors" DROP CONSTRAINT IF EXISTS "connectors_webhook_token_id_api_tokens_id_fk";--> statement-breakpoint
ALTER TABLE "ph_assets"."connectors" DROP COLUMN "webhook_token_id";--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_scope_check";--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" ADD CONSTRAINT "api_tokens_scope_check" CHECK ("ph_core"."api_tokens"."scope" IN ('project_api', 'global_mcp', 'webhook'));--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_scope_fields_check";--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" ADD CONSTRAINT "api_tokens_scope_fields_check" CHECK ((
        ("ph_core"."api_tokens"."scope" = 'project_api' AND "ph_core"."api_tokens"."project_id" IS NOT NULL AND "ph_core"."api_tokens"."connector_id" IS NULL) OR
        ("ph_core"."api_tokens"."scope" = 'global_mcp'  AND "ph_core"."api_tokens"."project_id" IS NULL     AND "ph_core"."api_tokens"."connector_id" IS NULL) OR
        ("ph_core"."api_tokens"."scope" = 'webhook'     AND "ph_core"."api_tokens"."project_id" IS NOT NULL AND "ph_core"."api_tokens"."connector_id" IS NOT NULL)
      ));--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" ADD CONSTRAINT "api_tokens_connector_id_fkey" FOREIGN KEY ("connector_id") REFERENCES "ph_assets"."connectors"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX "idx_api_tokens_connector" ON "ph_core"."api_tokens" USING btree ("connector_id") WHERE "ph_core"."api_tokens"."scope" = 'webhook' AND "ph_core"."api_tokens"."revoked_at" IS NULL;
