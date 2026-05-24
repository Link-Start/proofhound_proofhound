import { z } from 'zod';
import { canaryReleaseRunConfigSchema } from './canary-release.dto';
import { productionReleaseRunConfigSchema } from './production-release.dto';

export const releaseLineStatusSchema = z.enum([
  'canary',
  'production',
  'production_with_canary',
  'stopped',
  'archived',
]);
export type ReleaseLineStatusDto = z.infer<typeof releaseLineStatusSchema>;

export const releaseLineLaneTypeSchema = z.enum(['production', 'canary']);
export type ReleaseLineLaneTypeDto = z.infer<typeof releaseLineLaneTypeSchema>;

export const releaseLineEventStatusSchema = z.enum([
  'running',
  'stopped',
  'completed',
  'failed',
  'cancelled',
  'archived',
]);
export type ReleaseLineEventStatusDto = z.infer<typeof releaseLineEventStatusSchema>;

export const releaseLineEventOperationSchema = z.enum([
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
  'archive_line',
]);
export type ReleaseLineEventOperationDto = z.infer<typeof releaseLineEventOperationSchema>;

export const releaseLineEventTerminalReasonSchema = z.enum([
  'replaced',
  'rolled_back',
  'force_stopped',
  'promoted',
  'cancelled',
  'archived',
  'error',
]);
export type ReleaseLineEventTerminalReasonDto = z.infer<typeof releaseLineEventTerminalReasonSchema>;

const connectorSnapshotSchema = z.record(z.string(), z.unknown());
const promptSnapshotSchema = z.record(z.string(), z.unknown());
const promptVersionSnapshotSchema = z.record(z.string(), z.unknown());
const modelSnapshotSchema = z.record(z.string(), z.unknown());

export const releaseLineOutputConnectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
});
export type ReleaseLineOutputConnectorDto = z.infer<typeof releaseLineOutputConnectorSchema>;

export const releaseVariantSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  variantNumber: z.number().int().positive(),
  label: z.string(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().nullable(),
  promptVersionLabel: z.string().nullable(),
  promptSnapshot: promptSnapshotSchema,
  promptVersionSnapshot: promptVersionSnapshotSchema,
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  modelSnapshot: modelSnapshotSchema,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReleaseVariantDto = z.infer<typeof releaseVariantSchema>;

export const releaseLineEventSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  releaseVariantId: z.string().uuid().nullable(),
  releaseVariantNumber: z.number().int().positive().nullable(),
  releaseVariantLabel: z.string().nullable(),
  annotationTaskId: z.string().uuid().nullable(),
  laneType: releaseLineLaneTypeSchema,
  operation: releaseLineEventOperationSchema,
  status: releaseLineEventStatusSchema,
  terminalReason: releaseLineEventTerminalReasonSchema.nullable(),
  sourceEventId: z.string().uuid().nullable(),
  sourceLegacySource: z.enum(['production_release_event', 'canary_release']).nullable(),
  sourceLegacyId: z.string().uuid().nullable(),
  supersedesEventId: z.string().uuid().nullable(),
  rollbackTargetEventId: z.string().uuid().nullable(),
  legacySource: z.enum(['production_release_event', 'canary_release']).nullable(),
  legacySourceId: z.string().uuid().nullable(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string(),
  promptVersionId: z.string().uuid().nullable(),
  promptVersionNumber: z.number().int().nullable(),
  promptVersionLabel: z.string().nullable(),
  promptSnapshot: promptSnapshotSchema,
  promptVersionSnapshot: promptVersionSnapshotSchema,
  modelId: z.string().uuid().nullable(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  modelSnapshot: modelSnapshotSchema,
  inputConnectorId: z.string().uuid().nullable(),
  inputConnectorName: z.string().nullable(),
  inputConnectorType: z.string().nullable(),
  inputConnectorSnapshot: connectorSnapshotSchema,
  outputConnectorIds: z.array(z.string().uuid()),
  outputConnectors: z.array(releaseLineOutputConnectorSchema),
  outputConnectorSnapshots: z.array(connectorSnapshotSchema),
  trafficMode: z.enum(['split', 'dual_run']).nullable(),
  trafficRatio: z.number().min(0).max(1).nullable(),
  runConfig: z.record(z.string(), z.unknown()),
  variableMapping: z.unknown(),
  outputMapping: z.unknown(),
  filterRules: z.unknown().nullable(),
  recordMode: z.enum(['all', 'correct_only']),
  externalIdField: z.string().nullable(),
  retentionDays: z.number().int().positive().nullable(),
  sourceExperimentId: z.string().uuid().nullable(),
  submitReason: z.string(),
  metrics: z.record(z.string(), z.unknown()).nullable(),
  totalReceived: z.number().int().nonnegative(),
  totalProcessed: z.number().int().nonnegative(),
  totalFiltered: z.number().int().nonnegative(),
  totalCorrect: z.number().int().nonnegative(),
  totalErrors: z.number().int().nonnegative(),
  controlState: z.string().nullable(),
  controlStatePayload: z.record(z.string(), z.unknown()).nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ReleaseLineEventDto = z.infer<typeof releaseLineEventSchema>;

export const releaseLineSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string(),
  promptSnapshot: promptSnapshotSchema,
  inputConnectorId: z.string().uuid().nullable(),
  inputConnectorName: z.string().nullable(),
  inputConnectorType: z.string().nullable(),
  inputConnectorSnapshot: connectorSnapshotSchema,
  status: releaseLineStatusSchema,
  currentProductionEventId: z.string().uuid().nullable(),
  activeCanaryEventId: z.string().uuid().nullable(),
  currentProductionEvent: releaseLineEventSchema.nullable(),
  activeCanaryEvent: releaseLineEventSchema.nullable(),
  variants: z.array(releaseVariantSchema),
  outputConnectors: z.array(releaseLineOutputConnectorSchema),
  latestEvent: releaseLineEventSchema.nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  archivedAt: z.string().datetime().nullable(),
});
export type ReleaseLineDto = z.infer<typeof releaseLineSchema>;

export const releaseLineListResponseSchema = z.object({
  data: z.array(releaseLineSchema),
  total: z.number().int().nonnegative(),
});
export type ReleaseLineListResponseDto = z.infer<typeof releaseLineListResponseSchema>;

export const releaseLineEventListResponseSchema = z.object({
  data: z.array(releaseLineEventSchema),
  total: z.number().int().nonnegative(),
});
export type ReleaseLineEventListResponseDto = z.infer<typeof releaseLineEventListResponseSchema>;

export const updateReleaseLineTrafficRatioInputSchema = z.object({
  trafficRatio: z.number().min(0).max(1),
});
export type UpdateReleaseLineTrafficRatioInputDto = z.infer<typeof updateReleaseLineTrafficRatioInputSchema>;

export const updateReleaseLineRunConfigInputSchema = z.discriminatedUnion('laneType', [
  z.object({
    laneType: z.literal('production'),
    modelId: z.string().uuid().optional(),
    runConfig: productionReleaseRunConfigSchema,
  }),
  z.object({
    laneType: z.literal('canary'),
    modelId: z.string().uuid().optional(),
    runConfig: canaryReleaseRunConfigSchema,
  }),
]);
export type UpdateReleaseLineRunConfigInputDto = z.infer<typeof updateReleaseLineRunConfigInputSchema>;

export const RELEASE_LINE_STATUSES = releaseLineStatusSchema.options;
export const RELEASE_LINE_EVENT_STATUSES = releaseLineEventStatusSchema.options;
export const RELEASE_LINE_EVENT_OPERATIONS = releaseLineEventOperationSchema.options;
