// ph_releases.release_lines / release_line_events — unified release model
// 详见 docs/specs/06-database-schema.md §6 与 docs/specs/27-releases.md

import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, numeric, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { connectors, models } from '../ph_assets/index';
import { projects } from '../ph_core/index';
import { experiments } from '../ph_runs/experiments';
import { phReleases } from './_schema';

export const releaseLines = phReleases.table(
  'release_lines',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    promptId: uuid('prompt_id'),
    promptName: text('prompt_name').notNull(),
    promptSnapshot: jsonb('prompt_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    inputConnectorId: uuid('input_connector_id').references(() => connectors.id),
    inputConnectorName: text('input_connector_name'),
    inputConnectorType: text('input_connector_type'),
    inputConnectorSnapshot: jsonb('input_connector_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),

    status: text('status').notNull().default('canary'),
    currentProductionEventId: uuid('current_production_event_id'),
    activeCanaryEventId: uuid('active_canary_event_id'),

    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'release_lines_status_check',
      sql`${t.status} IN ('canary', 'production', 'production_with_canary', 'stopped', 'archived')`,
    ),
    uniqueIndex('uniq_active_release_line_per_input_connector')
      .on(t.inputConnectorId)
      .where(sql`${t.status} <> 'archived' AND ${t.inputConnectorId} IS NOT NULL`),
    uniqueIndex('uniq_release_lines_project_name').on(t.projectId, t.name),
    index('idx_release_lines_project_status').on(t.projectId, t.status, t.updatedAt),
    index('idx_release_lines_project_prompt').on(t.projectId, t.promptId),
    index('idx_release_lines_project_input').on(t.projectId, t.inputConnectorId),
  ],
);

export const releaseVariants = phReleases.table(
  'release_variants',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    releaseLineId: uuid('release_line_id')
      .notNull()
      .references(() => releaseLines.id, { onDelete: 'cascade' }),
    variantNumber: integer('variant_number').notNull(),
    promptId: uuid('prompt_id'),
    promptName: text('prompt_name').notNull(),
    promptVersionId: uuid('prompt_version_id').notNull(),
    promptVersionNumber: integer('prompt_version_number'),
    promptSnapshot: jsonb('prompt_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    promptVersionSnapshot: jsonb('prompt_version_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    modelId: uuid('model_id')
      .notNull()
      .references(() => models.id),
    modelSnapshot: jsonb('model_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('release_variants_number_positive_check', sql`${t.variantNumber} > 0`),
    uniqueIndex('uniq_release_variants_line_number').on(t.releaseLineId, t.variantNumber),
    uniqueIndex('uniq_release_variants_line_prompt_model').on(t.releaseLineId, t.promptVersionId, t.modelId),
    index('idx_release_variants_project_line').on(t.projectId, t.releaseLineId),
    index('idx_release_variants_project_prompt_model').on(t.projectId, t.promptVersionId, t.modelId),
  ],
);

export const releaseLineEvents = phReleases.table(
  'release_line_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    releaseLineId: uuid('release_line_id')
      .notNull()
      .references(() => releaseLines.id, { onDelete: 'cascade' }),

    laneType: text('lane_type').notNull(),
    operation: text('operation').notNull(),
    status: text('status').notNull(),
    terminalReason: text('terminal_reason'),
    sourceEventId: uuid('source_event_id'),
    supersedesEventId: uuid('supersedes_event_id'),
    rollbackTargetEventId: uuid('rollback_target_event_id'),
    legacySource: text('legacy_source'),
    legacySourceId: uuid('legacy_source_id'),
    releaseVariantId: uuid('release_variant_id').references(() => releaseVariants.id),

    promptId: uuid('prompt_id'),
    promptName: text('prompt_name').notNull(),
    promptVersionId: uuid('prompt_version_id'),
    promptVersionNumber: integer('prompt_version_number'),
    promptSnapshot: jsonb('prompt_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    promptVersionSnapshot: jsonb('prompt_version_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),

    modelId: uuid('model_id').references(() => models.id),
    modelSnapshot: jsonb('model_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    inputConnectorId: uuid('input_connector_id').references(() => connectors.id),
    inputConnectorSnapshot: jsonb('input_connector_snapshot')
      .notNull()
      .default(sql`'{}'::jsonb`),
    outputConnectorIds: uuid('output_connector_ids')
      .array()
      .notNull()
      .default(sql`ARRAY[]::uuid[]`),
    outputConnectorSnapshots: jsonb('output_connector_snapshots')
      .notNull()
      .default(sql`'[]'::jsonb`),

    trafficMode: text('traffic_mode'),
    trafficRatio: numeric('traffic_ratio', { precision: 5, scale: 4 }),
    runConfig: jsonb('run_config')
      .notNull()
      .default(sql`'{}'::jsonb`),
    variableMapping: jsonb('variable_mapping')
      .notNull()
      .default(sql`'{}'::jsonb`),
    outputMapping: jsonb('output_mapping')
      .notNull()
      .default(sql`'[]'::jsonb`),
    filterRules: jsonb('filter_rules'),
    recordMode: text('record_mode').notNull().default('all'),
    externalIdField: text('external_id_field'),
    retentionDays: integer('retention_days'),

    sourceExperimentId: uuid('source_experiment_id').references(() => experiments.id),
    submitReason: text('submit_reason').notNull().default(''),
    metrics: jsonb('metrics'),
    totalReceived: integer('total_received').notNull().default(0),
    totalProcessed: integer('total_processed').notNull().default(0),
    totalFiltered: integer('total_filtered').notNull().default(0),
    totalCorrect: integer('total_correct').notNull().default(0),
    totalErrors: integer('total_errors').notNull().default(0),

    controlState: text('control_state'),
    controlStatePayload: jsonb('control_state_payload'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('release_line_events_lane_type_check', sql`${t.laneType} IN ('production', 'canary')`),
    check(
      'release_line_events_operation_check',
      sql`${t.operation} IN (
        'create_production',
        'create_production_from_experiment',
        'create_canary',
        'traffic_updated',
        'mode_updated',
        'config_changed',
        'stop_lane',
        'resume_lane',
        'cancel_canary',
        'promote_canary',
        'rollback',
        'force_stop',
        'archive_line'
      )`,
    ),
    check(
      'release_line_events_status_check',
      sql`${t.status} IN ('running', 'stopped', 'completed', 'failed', 'cancelled', 'archived')`,
    ),
    check(
      'release_line_events_terminal_reason_check',
      sql`${t.terminalReason} IN ('replaced', 'rolled_back', 'force_stopped', 'promoted', 'cancelled', 'archived', 'error') OR ${t.terminalReason} IS NULL`,
    ),
    check(
      'release_line_events_traffic_mode_check',
      sql`${t.trafficMode} IN ('split', 'dual_run') OR ${t.trafficMode} IS NULL`,
    ),
    check(
      'release_line_events_traffic_ratio_check',
      sql`${t.trafficRatio} IS NULL OR (${t.trafficRatio} >= 0 AND ${t.trafficRatio} <= 1)`,
    ),
    check('release_line_events_record_mode_check', sql`${t.recordMode} IN ('all', 'correct_only')`),
    check(
      'release_line_events_rollback_target_required',
      sql`${t.operation} <> 'rollback' OR ${t.rollbackTargetEventId} IS NOT NULL`,
    ),
    check(
      'release_line_events_promote_source_required',
      sql`${t.operation} <> 'promote_canary' OR ${t.sourceEventId} IS NOT NULL`,
    ),
    check(
      'release_line_events_legacy_source_check',
      sql`${t.legacySource} IN ('production_release_event', 'canary_release') OR ${t.legacySource} IS NULL`,
    ),
    uniqueIndex('uniq_release_line_event_legacy_source')
      .on(t.projectId, t.legacySource, t.legacySourceId)
      .where(sql`${t.legacySource} IS NOT NULL AND ${t.legacySourceId} IS NOT NULL`),
    uniqueIndex('uniq_running_production_event_per_line')
      .on(t.releaseLineId)
      .where(sql`${t.laneType} = 'production' AND ${t.status} = 'running'`),
    uniqueIndex('uniq_active_canary_event_per_line')
      .on(t.releaseLineId)
      .where(sql`${t.laneType} = 'canary' AND ${t.status} IN ('running', 'stopped')`),
    uniqueIndex('uniq_running_production_event_per_prompt')
      .on(t.promptId)
      .where(sql`${t.laneType} = 'production' AND ${t.status} = 'running' AND ${t.promptId} IS NOT NULL`),
    index('idx_release_line_events_line_created').on(t.releaseLineId, t.createdAt),
    index('idx_release_line_events_project_lane_status').on(t.projectId, t.laneType, t.status, t.createdAt),
    index('idx_release_line_events_project_prompt').on(t.projectId, t.promptId, t.createdAt),
    index('idx_release_line_events_variant').on(t.releaseVariantId),
  ],
);
