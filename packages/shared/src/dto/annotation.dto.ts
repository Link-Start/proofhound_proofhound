import { z } from 'zod';

export const annotationTaskScopeSchema = z.enum(['canary', 'online']);
export type AnnotationTaskScopeDto = z.infer<typeof annotationTaskScopeSchema>;

export const annotationTaskStatusSchema = z.enum(['active', 'completed', 'archived']);
export type AnnotationTaskStatusDto = z.infer<typeof annotationTaskStatusSchema>;

export const annotationSampleStatusSchema = z.enum(['pending', 'claimed', 'submitted']);
export type AnnotationSampleStatusDto = z.infer<typeof annotationSampleStatusSchema>;

export const annotationTaskProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  claimed: z.number().int().nonnegative(),
  submitted: z.number().int().nonnegative(),
});
export type AnnotationTaskProgressDto = z.infer<typeof annotationTaskProgressSchema>;

export const annotationTaskQualitySchema = z
  .object({
    matched: z.number().int().nonnegative(),
    mismatched: z.number().int().nonnegative(),
    score: z.number().min(0).max(1),
  })
  .nullable();
export type AnnotationTaskQualityDto = z.infer<typeof annotationTaskQualitySchema>;

export const annotationReleaseVariantOptionSchema = z.object({
  id: z.string().uuid(),
  releaseLineId: z.string().uuid(),
  label: z.string(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().positive().nullable(),
  promptVersionLabel: z.string().nullable(),
  categoryOptions: z.array(z.string().trim().min(1)).default([]),
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  canaryCount: z.number().int().nonnegative(),
  onlineCount: z.number().int().nonnegative(),
});
export type AnnotationReleaseVariantOptionDto = z.infer<typeof annotationReleaseVariantOptionSchema>;

export const annotationReleaseLineOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  promptName: z.string(),
  inputConnectorName: z.string().nullable(),
  variants: z.array(annotationReleaseVariantOptionSchema),
});
export type AnnotationReleaseLineOptionDto = z.infer<typeof annotationReleaseLineOptionSchema>;

export const annotationTaskDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  scope: annotationTaskScopeSchema,
  releaseLineId: z.string().uuid(),
  releaseLineName: z.string(),
  releaseVariantId: z.string().uuid(),
  releaseVariantLabel: z.string(),
  promptName: z.string(),
  promptVersionId: z.string().uuid(),
  promptVersionNumber: z.number().int().positive().nullable(),
  promptVersionLabel: z.string().nullable(),
  categoryOptions: z.array(z.string().trim().min(1)).default([]),
  modelId: z.string().uuid(),
  modelName: z.string().nullable(),
  modelProvider: z.string().nullable(),
  status: annotationTaskStatusSchema,
  progress: annotationTaskProgressSchema,
  quality: annotationTaskQualitySchema,
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AnnotationTaskDto = z.infer<typeof annotationTaskDtoSchema>;

export const annotationTaskListResponseSchema = z.object({
  data: z.array(annotationTaskDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AnnotationTaskListResponseDto = z.infer<typeof annotationTaskListResponseSchema>;

export const annotationTaskOptionsResponseSchema = z.object({
  data: z.array(annotationReleaseLineOptionSchema),
  total: z.number().int().nonnegative(),
});
export type AnnotationTaskOptionsResponseDto = z.infer<typeof annotationTaskOptionsResponseSchema>;

export const createAnnotationTaskInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  releaseLineId: z.string().uuid(),
  releaseVariantId: z.string().uuid(),
  scope: annotationTaskScopeSchema,
  sampleSize: z.number().int().min(1).max(10_000),
});
export type CreateAnnotationTaskInputDto = z.infer<typeof createAnnotationTaskInputSchema>;

export const annotationSampleDtoSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  runResultId: z.string().uuid(),
  externalId: z.string().nullable(),
  inputPreview: z.string().nullable(),
  outputPreview: z.string().nullable(),
  inputVariables: z.record(z.string(), z.unknown()).nullable(),
  renderedPrompt: z.unknown().nullable(),
  decisionOutput: z.string().nullable(),
  expectedOutput: z.string().nullable(),
  annotatedExpectedOutput: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  rawResponse: z.string().nullable(),
  parsedOutput: z.unknown().nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  notes: z.string().nullable(),
  lockedBy: z.string().uuid().nullable(),
  lockedAt: z.string().datetime().nullable(),
  lockHeartbeatAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  submittedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
});
export type AnnotationSampleDto = z.infer<typeof annotationSampleDtoSchema>;

export const annotationSampleListResponseSchema = z.object({
  data: z.array(annotationSampleDtoSchema),
  total: z.number().int().nonnegative(),
});
export type AnnotationSampleListResponseDto = z.infer<typeof annotationSampleListResponseSchema>;

export const claimAnnotationSamplesInputSchema = z.object({
  batchSize: z.number().int().min(1).max(100),
});
export type ClaimAnnotationSamplesInputDto = z.infer<typeof claimAnnotationSamplesInputSchema>;

export const claimAnnotationSamplesResponseSchema = z.object({
  data: z.array(annotationSampleDtoSchema),
  claimedCount: z.number().int().nonnegative(),
});
export type ClaimAnnotationSamplesResponseDto = z.infer<typeof claimAnnotationSamplesResponseSchema>;

export const submitAnnotationSampleInputSchema = z.object({
  annotationId: z.string().uuid(),
  expectedOutput: z.string().trim().min(1).max(4000),
  notes: z.string().max(4000).nullable(),
});
export type SubmitAnnotationSampleInputDto = z.infer<typeof submitAnnotationSampleInputSchema>;

export const releaseAnnotationSampleInputSchema = z.object({
  annotationId: z.string().uuid(),
});
export type ReleaseAnnotationSampleInputDto = z.infer<typeof releaseAnnotationSampleInputSchema>;
