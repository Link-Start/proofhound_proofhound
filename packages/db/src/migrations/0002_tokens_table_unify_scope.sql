-- 0002 token model refactor: rename api_tokens → tokens, merge project_api + global_mcp into user, drop the global MCP singleton constraint
-- See docs/specs/06-database-schema.md §3.2 / docs/specs/08-saas-adapter-boundary.md §3.5
--
-- Order:
--   a) drop constraints / indexes tightly bound to the legacy scope (CHECK, uniq_active_global_mcp_token)
--   b) data backfill: move project_api / global_mcp rows uniformly to scope='user', set project_id to NULL
--   c) rename the table + rename the indexes / FKs / unique constraints that still exist
--   d) rebuild CHECK; the new value set = ('user', 'webhook'); user allows any project_id; webhook unchanged
--
-- Not handled in this migration:
--   - scope='webhook' row constraints / FKs inherit the shape built in 0001; this migration only renames them
--   - column shapes for token_hash UNIQUE / token_encrypted / prefix remain unchanged

-- a) Drop the global-MCP singleton constraint tied to the legacy scope
DROP INDEX IF EXISTS "ph_core"."uniq_active_global_mcp_token";--> statement-breakpoint

-- a) Drop CHECK first (before backfill), to avoid new values failing the old constraint
ALTER TABLE "ph_core"."api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_scope_fields_check";--> statement-breakpoint
ALTER TABLE "ph_core"."api_tokens" DROP CONSTRAINT IF EXISTS "api_tokens_scope_check";--> statement-breakpoint

-- b) Data backfill: move project_api / global_mcp uniformly to user; user is not bound to project_id
UPDATE "ph_core"."api_tokens"
SET scope = 'user',
    project_id = NULL
WHERE scope IN ('project_api', 'global_mcp');--> statement-breakpoint

-- c) rename table
ALTER TABLE "ph_core"."api_tokens" RENAME TO "tokens";--> statement-breakpoint

-- c) Rename indexes (the partial index WHERE clause is preserved unchanged)
ALTER INDEX "ph_core"."idx_api_tokens_project" RENAME TO "idx_tokens_project";--> statement-breakpoint
ALTER INDEX "ph_core"."idx_api_tokens_active" RENAME TO "idx_tokens_active";--> statement-breakpoint
ALTER INDEX "ph_core"."idx_api_tokens_connector" RENAME TO "idx_tokens_connector";--> statement-breakpoint

-- c) Rename FK / unique constraints (referring to 0000 / 0001 drizzle auto-naming)
ALTER TABLE "ph_core"."tokens" RENAME CONSTRAINT "api_tokens_project_id_projects_id_fk" TO "tokens_project_id_projects_id_fk";--> statement-breakpoint
ALTER TABLE "ph_core"."tokens" RENAME CONSTRAINT "api_tokens_connector_id_fkey" TO "tokens_connector_id_fkey";--> statement-breakpoint
ALTER TABLE "ph_core"."tokens" RENAME CONSTRAINT "api_tokens_token_hash_unique" TO "tokens_token_hash_unique";--> statement-breakpoint

-- d) Rebuild CHECK: scope ∈ {user, webhook}
ALTER TABLE "ph_core"."tokens" ADD CONSTRAINT "tokens_scope_check"
  CHECK ("ph_core"."tokens"."scope" IN ('user', 'webhook'));--> statement-breakpoint

-- d) Rebuild scope_fields CHECK:
--    - user only enforces connector_id IS NULL; project_id can be anything (OSS defaults to NULL; the SaaS form may attach a project)
--    - webhook keeps the original constraint (project_id + connector_id required)
ALTER TABLE "ph_core"."tokens" ADD CONSTRAINT "tokens_scope_fields_check" CHECK ((
  ("ph_core"."tokens"."scope" = 'user'    AND "ph_core"."tokens"."connector_id" IS NULL) OR
  ("ph_core"."tokens"."scope" = 'webhook' AND "ph_core"."tokens"."project_id" IS NOT NULL AND "ph_core"."tokens"."connector_id" IS NOT NULL)
));
