// ph_core — projects and application tokens
// 详见 docs/specs/06-database-schema.md §3

import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const phCore = pgSchema('ph_core');

export const projects = phCore.table(
  'projects',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    name: text('name').notNull(),
    description: text('description'),
    type: text('type').notNull().default('classification'),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    check('projects_type_check', sql`${t.type} IN ('classification', 'generative', 'agent')`),
    check('projects_status_check', sql`${t.status} IN ('active', 'archived')`),
    index('idx_projects_active')
      .on(t.status)
      .where(sql`${t.deletedAt} IS NULL`),
  ],
);

export const apiTokens = phCore.table(
  'api_tokens',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    scope: text('scope').notNull(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    tokenEncrypted: text('token_encrypted'),
    prefix: text('prefix').notNull(),
    ipWhitelist: jsonb('ip_whitelist'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    check('api_tokens_scope_check', sql`${t.scope} IN ('project_api', 'global_mcp')`),
    check(
      'api_tokens_scope_fields_check',
      sql`(
        (${t.scope} = 'project_api' AND ${t.projectId} IS NOT NULL) OR
        (${t.scope} = 'global_mcp'  AND ${t.projectId} IS NULL)
      )`,
    ),
    index('idx_api_tokens_project')
      .on(t.projectId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('idx_api_tokens_active')
      .on(t.scope)
      .where(sql`${t.revokedAt} IS NULL`),
    uniqueIndex('uniq_active_global_mcp_token')
      .on(t.scope)
      .where(sql`${t.scope} = 'global_mcp' AND ${t.revokedAt} IS NULL`),
  ],
);
