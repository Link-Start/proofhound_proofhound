-- Webhook token 迁移到 scope='webhook' + connector_id 正向关联
-- 详见 docs/specs/06-database-schema.md §3.2 / §4.5
--
-- 顺序：
--   a) 先在 api_tokens 上加 connector_id 列
--   b) 用 connectors.webhook_token_id 回填到 api_tokens.connector_id 并把 scope 升级为 'webhook'
--   c) 删除 connectors.webhook_token_id 旧 FK + 列
--   d) 升级 api_tokens 的 scope CHECK 与 scope_fields CHECK
--   e) 新增 connector_id FK + partial index
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
