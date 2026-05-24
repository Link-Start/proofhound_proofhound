import { z } from 'zod';

export const SOURCE_BUCKETS = ['prod', 'canary', 'iter', 'exp'] as const;
export type SourceBucket = (typeof SOURCE_BUCKETS)[number];

export const SOURCE_TO_BUCKET: Readonly<Record<string, SourceBucket>> = {
  online: 'prod',
  canary: 'canary',
  optimization_analysis: 'iter',
  optimization_generate: 'iter',
  experiment: 'exp',
};

export const BUCKET_TO_SOURCES: Readonly<Record<SourceBucket, readonly string[]>> = {
  prod: ['online'],
  canary: ['canary'],
  iter: ['optimization_analysis', 'optimization_generate'],
  exp: ['experiment'],
};

export const monitoringGranularitySchema = z.enum(['auto', 'minute', 'hour', 'day']);
export type MonitoringGranularity = z.infer<typeof monitoringGranularitySchema>;

export const projectMonitoringFilterSchema = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  modelIds: z.array(z.string().uuid()).optional(),
  promptIds: z.array(z.string().uuid()).optional(),
  promptVersionIds: z.array(z.string().uuid()).optional(),
  sourceIds: z.array(z.string().uuid()).optional(),
  sources: z.array(z.enum(SOURCE_BUCKETS)).optional(),
  granularity: monitoringGranularitySchema.default('auto'),
});
export type ProjectMonitoringFilterDto = z.infer<typeof projectMonitoringFilterSchema>;

export const sourceBucketValuesSchema = z.object({
  prod: z.number(),
  canary: z.number(),
  iter: z.number(),
  exp: z.number(),
});
export type SourceBucketValuesDto = z.infer<typeof sourceBucketValuesSchema>;

export const projectMonitoringKpiSchema = z.object({
  total: z.number(),
  previous: z.number(),
  bySource: sourceBucketValuesSchema,
});
export type ProjectMonitoringKpiDto = z.infer<typeof projectMonitoringKpiSchema>;

export const projectMonitoringStatsSchema = z.object({
  requests: projectMonitoringKpiSchema,
  errors: projectMonitoringKpiSchema,
  rpmPeak: projectMonitoringKpiSchema,
  tpmPeak: projectMonitoringKpiSchema,
  latencyAverageMs: projectMonitoringKpiSchema,
  latencyP50Ms: projectMonitoringKpiSchema,
  latencyP95Ms: projectMonitoringKpiSchema,
  latencyP99Ms: projectMonitoringKpiSchema,
  tokens: projectMonitoringKpiSchema,
  cost: projectMonitoringKpiSchema,
});
export type ProjectMonitoringStatsDto = z.infer<typeof projectMonitoringStatsSchema>;

export const projectMonitoringTimeseriesBucketSchema = z.object({
  bucketAt: z.string().datetime(),
  requests: sourceBucketValuesSchema,
  errors: sourceBucketValuesSchema,
  rpm: sourceBucketValuesSchema,
  tpm: sourceBucketValuesSchema,
  latencyAverageMs: sourceBucketValuesSchema,
  latencyP50Ms: sourceBucketValuesSchema,
  latencyP95Ms: sourceBucketValuesSchema,
  latencyP99Ms: sourceBucketValuesSchema,
  tokens: sourceBucketValuesSchema,
  cost: sourceBucketValuesSchema,
});
export type ProjectMonitoringTimeseriesBucketDto = z.infer<typeof projectMonitoringTimeseriesBucketSchema>;

export const projectMonitoringTimeseriesSchema = z.object({
  granularity: z.enum(['minute', 'hour', 'day']),
  points: z.array(projectMonitoringTimeseriesBucketSchema),
});
export type ProjectMonitoringTimeseriesDto = z.infer<typeof projectMonitoringTimeseriesSchema>;

export const promptMonitoringRankingSortBy = ['requests', 'cost', 'failureRate'] as const;
export const promptMonitoringRankingItemSchema = z.object({
  promptId: z.string().uuid(),
  promptName: z.string(),
  latestVersionNumber: z.number().int().positive().nullable(),
  versionCount: z.number().int().nonnegative(),
  requestCount: z.number(),
  shareRatio: z.number(),
  costEstimate: z.number(),
  failureRate: z.number(),
  hitRate: z.number().nullable(),
});
export type PromptMonitoringRankingItemDto = z.infer<typeof promptMonitoringRankingItemSchema>;

export const promptMonitoringRankingResponseSchema = z.object({
  sortBy: z.enum(promptMonitoringRankingSortBy),
  items: z.array(promptMonitoringRankingItemSchema),
});
export type PromptMonitoringRankingResponseDto = z.infer<typeof promptMonitoringRankingResponseSchema>;

export const modelMonitoringRankingSortBy = ['requests', 'tokens', 'cost'] as const;
export const modelMonitoringRankingItemSchema = z.object({
  modelId: z.string().uuid(),
  modelName: z.string(),
  providerType: z.string(),
  providerModelId: z.string(),
  requestCount: z.number(),
  totalTokens: z.number(),
  costEstimate: z.number(),
  capacityUsedRatio: z.number().nullable(),
  rpmLimit: z.number(),
});
export type ModelMonitoringRankingItemDto = z.infer<typeof modelMonitoringRankingItemSchema>;

export const modelMonitoringRankingResponseSchema = z.object({
  sortBy: z.enum(modelMonitoringRankingSortBy),
  items: z.array(modelMonitoringRankingItemSchema),
});
export type ModelMonitoringRankingResponseDto = z.infer<typeof modelMonitoringRankingResponseSchema>;
