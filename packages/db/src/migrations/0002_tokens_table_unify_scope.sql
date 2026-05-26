-- 0002 token 模型重构：rename api_tokens → tokens、合并 project_api + global_mcp 为 user、移除全局 MCP 单例约束
-- 详见 docs/specs/06-database-schema.md §3.2 / docs/specs/08-saas-adapter-boundary.md §3.5
--
-- 顺序：
--   a) drop 与旧 scope 强绑定的约束 / 索引（CHECK、uniq_active_global_mcp_token）
--   b) 数据回填：把 project_api / global_mcp 行统一改为 scope='user'，project_id 置 NULL
--   c) rename 表 + rename 仍存在的索引 / FK / unique 约束
--   d) 重建 CHECK，新值集 = ('user', 'webhook'); user 允许 project_id 任意，webhook 不变
--
-- 不在本 migration 处理：
--   - scope='webhook' 行的约束 / FK 沿用 0001 已建好的形态，仅做改名
--   - token_hash UNIQUE / token_encrypted / prefix 等列形态不动

-- a) 删除旧 scope 关联的全局 MCP 单例约束
DROP INDEX IF EXISTS "ph_core"."uniq_active_global_mcp_token";--> statement-breakpoint

-- a) 先删 CHECK（数据回填之前），避免新值不满足旧约束
ALTER TABLE "ph_core"."api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_scope_fields_check";--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_scope_check";--> statement-breakpoint

-- b) 数据回填：project_api / global_mcp 统一改为 user；user 不绑定 project_id
UPDATE "ph_core"."api_tokens"
SET scope = 'user',
    project_id = NULL
WHERE scope IN ('project_api', 'global_mcp');--> statement-breakpoint

-- c) rename table
ALTER TABLE "ph_core"."api_tokens" RENAME TO "tokens";--> statement-breakpoint

-- c) rename indexes（保留 partial index where 子句不变）
ALTER INDEX "ph_core"."idx_api_tokens_project" RENAME TO "idx_tokens_project";--> statement-breakpoint
ALTER INDEX "ph_core"."idx_api_tokens_active" RENAME TO "idx_tokens_active";--> statement-breakpoint
ALTER INDEX "ph_core"."idx_api_tokens_connector" RENAME TO "idx_tokens_connector";--> statement-breakpoint

-- c) rename FK / unique 约束（参考 0000 / 0001 drizzle 自动命名）
ALTER TABLE "ph_core"."tokens" RENAME CONSTRAINT "api_tokens_project_id_projects_id_fk" TO "tokens_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "ph_core"."tokens" RENAME CONSTRAINT "api_tokens_connector_id_fkey" TO "tokens_connector_id_fkey";--> statement-breakpoint
ALTER TABLE "ph_core"."tokens" RENAME CONSTRAINT "api_tokens_token_hash_unique" TO "tokens_token_hash_unique";--> statement-breakpoint

-- d) 重建 CHECK：scope ∈ {user, webhook}
ALTER TABLE "ph_core"."tokens" ADD CONSTRAINT "tokens_scope_check"
  CHECK ("ph_core"."tokens"."scope" IN ('user', 'webhook'));--> statement-breakpoint

-- d) 重建 scope_fields CHECK：
--    - user 仅强约束 connector_id IS NULL，project_id 允许任意（OSS 默认写 NULL；SaaS 形态可挂 project）
--    - webhook 保持原约束（project_id + connector_id 必填）
ALTER TABLE "ph_core"."tokens" ADD CONSTRAINT "tokens_scope_fields_check" CHECK ((
  ("ph_core"."tokens"."scope" = 'user'    AND "ph_core"."tokens"."connector_id" IS NULL) OR
  ("ph_core"."tokens"."scope" = 'webhook' AND "ph_core"."tokens"."project_id" IS NOT NULL AND "ph_core"."tokens"."connector_id" IS NOT NULL)
));
