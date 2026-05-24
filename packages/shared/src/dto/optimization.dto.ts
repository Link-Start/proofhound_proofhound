import { z } from 'zod';
import { promptLanguageSchema } from './prompt.dto';

export const optimizationIdParamSchema = z.string().uuid();
export type OptimizationIdParamDto = z.infer<typeof optimizationIdParamSchema>;

export const optimizationStatusSchema = z.enum(['running', 'success', 'failed', 'stopped', 'cancelled']);
export type OptimizationStatusDto = z.infer<typeof optimizationStatusSchema>;

export const optimizationControlActionSchema = z.enum(['stop', 'resume', 'cancel']);
export type OptimizationControlActionDto = z.infer<typeof optimizationControlActionSchema>;

export const optimizationStartingModeSchema = z.enum(['from_experiment', 'from_prompt_version', 'from_dataset_only']);
export type OptimizationStartingModeDto = z.infer<typeof optimizationStartingModeSchema>;

// 策略只用字符串：可插拔，不加 enum 约束（SPEC 25 §3）
export const optimizationStrategySchema = z.string().trim().min(1).max(64);
export type OptimizationStrategyDto = z.infer<typeof optimizationStrategySchema>;

export const optimizationHintSchema = z.string().trim().max(4000).optional().nullable();
export type OptimizationHintDto = z.infer<typeof optimizationHintSchema>;

export const optimizationGoalMetricSchema = z.enum(['accuracy', 'precision', 'recall', 'f1', 'fpr']);
export type OptimizationGoalMetricDto = z.infer<typeof optimizationGoalMetricSchema>;

export const createOptimizationGoalMetricSchema = z.enum(['accuracy', 'precision', 'recall']);
export type CreateOptimizationGoalMetricDto = z.infer<typeof createOptimizationGoalMetricSchema>;

export const optimizationGoalComparatorSchema = z.enum(['gte', 'gt', 'lte']);
export type OptimizationGoalComparatorDto = z.infer<typeof optimizationGoalComparatorSchema>;

export const optimizationGoalSchema = z.object({
  metric: optimizationGoalMetricSchema,
  comparator: optimizationGoalComparatorSchema,
  target: z.number().min(0).max(1),
  scope: z.string().trim().min(1).max(120), // 'overall' or a class label
});
export type OptimizationGoalDto = z.infer<typeof optimizationGoalSchema>;

export const createOptimizationGoalSchema = optimizationGoalSchema.extend({
  metric: createOptimizationGoalMetricSchema,
});
export type CreateOptimizationGoalDto = z.infer<typeof createOptimizationGoalSchema>;

export const optimizationFieldWhitelistSchema = z.object({
  inputFields: z.array(z.string().trim().min(1).max(160)),
  metaFields: z.array(z.string().trim().min(1).max(160)),
});
export type OptimizationFieldWhitelistDto = z.infer<typeof optimizationFieldWhitelistSchema>;

export const optimizationRunConfigSchema = z
  .object({
    temperature: z.number().min(0).max(2).optional(),
    concurrency: z.number().int().positive().optional(),
    rpmLimit: z.number().int().positive().optional(),
    tpmLimit: z.number().int().positive().optional(),
    sampleTimeoutSeconds: z.number().int().positive().optional(),
    retries: z.number().int().nonnegative().optional(),
    imageEncoding: z.enum(['url', 'base64']).optional(),
  })
  .catchall(z.unknown());
export type OptimizationRunConfigDto = z.infer<typeof optimizationRunConfigSchema>;

export const optimizationLoopLimitsSchema = z.object({
  maxRounds: z.number().int().min(1).max(50),
  // 0 = 不启用"连续无提升"早停（service 尚未消费该字段，待优化落地）
  stopAfterNoImprovementRounds: z.number().int().min(0).max(20),
});
export type OptimizationLoopLimitsDto = z.infer<typeof optimizationLoopLimitsSchema>;

export const optimizationBestMetricsSchema = z.record(z.string(), z.number()).nullable();
export type OptimizationBestMetricsDto = z.infer<typeof optimizationBestMetricsSchema>;

// finalize 时落库的收尾摘要;Service 层会做 reason ≤500 字符截断防止上游 API 报文外泄到前端
export const optimizationSummarySchema = z.object({
  kind: optimizationStatusSchema,
  reason: z.string(),
  finalizedAt: z.string(),
});
export type OptimizationSummaryDto = z.infer<typeof optimizationSummarySchema>;

// ---------------------------------------------------------------------------
// List item
// ---------------------------------------------------------------------------
export const optimizationListItemSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  strategy: optimizationStrategySchema,
  startingMode: optimizationStartingModeSchema,
  status: optimizationStatusSchema,
  controlState: z.enum(['stop', 'resume', 'cancel']).nullable(),

  sourceExperimentId: z.string().uuid().nullable(),
  sourceExperimentName: z.string().nullable(),
  promptId: z.string().uuid().nullable(),
  promptName: z.string().nullable(),
  baseVersionId: z.string().uuid().nullable(),
  baseVersionNumber: z.number().int().positive().nullable(),
  datasetId: z.string().uuid(),
  datasetName: z.string(),
  datasetSamples: z.number().int().nonnegative(),
  experimentModelId: z.string().uuid(),
  experimentModelName: z.string(),
  analysisModelId: z.string().uuid(),
  analysisModelName: z.string(),
  promptLanguage: promptLanguageSchema,

  goals: z.array(optimizationGoalSchema),
  fieldWhitelist: optimizationFieldWhitelistSchema.nullable(),
  runConfig: optimizationRunConfigSchema,
  maxRounds: z.number().int().positive(),
  currentRound: z.number().int().nonnegative(),
  bestVersionId: z.string().uuid().nullable(),
  bestVersionNumber: z.number().int().positive().nullable(),
  bestMetrics: optimizationBestMetricsSchema,
  // 每轮主指标（第一个目标的 metric）值，0-based 按 round_index 升序——LiveCard sparkline 直接消费
  // 若 trendHasBaseline 为 true,trend[0] 即 source experiment 的基线值,trend[1+] 才是各轮值
  trend: z.array(z.number()).nullable().optional(),
  trendHasBaseline: z.boolean().optional(),
  // finalize 时收尾摘要;失败任务 reason 是用户看到的核心信息
  summary: optimizationSummarySchema.nullable(),
  // 仅当分析 LLM 致命错时填，用于前端"分析阶段错误"细节
  analysisFailureReason: z.string().nullable(),

  dbosWorkflowId: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdByDisplayName: z.string().nullable(),
  createdByUsername: z.string().nullable(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  deletedAt: z.string().datetime().nullable(),
});
export type OptimizationListItemDto = z.infer<typeof optimizationListItemSchema>;

export const optimizationListResponseSchema = z.object({
  data: z.array(optimizationListItemSchema),
  total: z.number().int().nonnegative(),
});
export type OptimizationListResponseDto = z.infer<typeof optimizationListResponseSchema>;

// ---------------------------------------------------------------------------
// List query
// ---------------------------------------------------------------------------
export const optimizationSortSchema = z.enum(['updated', 'bestMetric', 'round']);
export type OptimizationSortDto = z.infer<typeof optimizationSortSchema>;

export const optimizationListQuerySchema = z.object({
  status: optimizationStatusSchema.optional(),
  search: z.string().trim().max(200).optional(),
  sort: optimizationSortSchema.optional(),
});
export type OptimizationListQueryDto = z.infer<typeof optimizationListQuerySchema>;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------
export const createOptimizationSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional().nullable(),
    optimizationHint: optimizationHintSchema,
    strategy: optimizationStrategySchema.default('error_pattern_analysis'),
    strategyConfig: z.record(z.string(), z.unknown()).optional(),
    startingMode: optimizationStartingModeSchema,
    sourceExperimentId: z.string().uuid().optional().nullable(),
    promptId: z.string().uuid().optional().nullable(),
    baseVersionId: z.string().uuid().optional().nullable(),
    datasetId: z.string().uuid(),
    experimentModelId: z.string().uuid(),
    analysisModelId: z.string().uuid(),
    promptLanguage: promptLanguageSchema.optional(),
    goals: z.array(createOptimizationGoalSchema).min(1).max(10),
    fieldWhitelist: optimizationFieldWhitelistSchema.optional().nullable(),
    runConfig: optimizationRunConfigSchema.optional(),
    loopLimits: optimizationLoopLimitsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.startingMode === 'from_experiment' && !value.sourceExperimentId) {
      ctx.addIssue({ code: 'custom', path: ['sourceExperimentId'], message: 'source_experiment_required' });
    }
    if (value.startingMode === 'from_prompt_version' && !value.promptId) {
      ctx.addIssue({ code: 'custom', path: ['promptId'], message: 'prompt_required' });
    }
  });
export type CreateOptimizationDto = z.infer<typeof createOptimizationSchema>;

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------
export const optimizationGoalScopeKindSchema = z.enum(['overall', 'class']);
export type OptimizationGoalScopeKindDto = z.infer<typeof optimizationGoalScopeKindSchema>;

export const optimizationDetailGoalScopeSchema = z.object({
  kind: optimizationGoalScopeKindSchema,
  classes: z.array(z.string()).optional(),
});
export type OptimizationDetailGoalScopeDto = z.infer<typeof optimizationDetailGoalScopeSchema>;

export const optimizationDetailGoalsLineSchema = z.object({
  label: z.string(),
  targetText: z.string(),
  tone: optimizationGoalScopeKindSchema,
});
export type OptimizationDetailGoalsLineDto = z.infer<typeof optimizationDetailGoalsLineSchema>;

export const optimizationDetailExperimentConfigSchema = z.object({
  datasetName: z.string(),
  promptName: z.string(),
  promptVersion: z.string(),
  modelName: z.string(),
  baselineExperiment: z.string(),
  temperature: z.number(),
  concurrency: z.number().int().nonnegative(),
  rpm: z.number().int().nonnegative(),
  tpm: z.number().int().nonnegative(),
});
export type OptimizationDetailExperimentConfigDto = z.infer<typeof optimizationDetailExperimentConfigSchema>;

export const optimizationDetailIterationConfigSchema = z.object({
  analysisModel: z.string(),
  strategy: optimizationStrategySchema,
  maxRounds: z.number().int().positive(),
  noImprovementStop: z.number().int().nonnegative(),
  regressionThreshold: z.number().nonnegative(),
});
export type OptimizationDetailIterationConfigDto = z.infer<typeof optimizationDetailIterationConfigSchema>;

export const optimizationDetailControlPhaseSchema = z.enum(['analysis', 'experiment', 'paused', 'finishing']);
export type OptimizationDetailControlPhaseDto = z.infer<typeof optimizationDetailControlPhaseSchema>;

export const optimizationDetailControlStripSchema = z.object({
  currentRound: z.number().int().nonnegative(),
  maxRounds: z.number().int().positive(),
  phase: optimizationDetailControlPhaseSchema,
  samplesDone: z.number().int().nonnegative(),
  samplesTotal: z.number().int().nonnegative(),
  roundRemaining: z.string(),
  totalRemaining: z.string(),
});
export type OptimizationDetailControlStripDto = z.infer<typeof optimizationDetailControlStripSchema>;

export const optimizationDetailMetricDeltaToneSchema = z.enum(['ok', 'bad', 'neutral']);
export type OptimizationDetailMetricDeltaToneDto = z.infer<typeof optimizationDetailMetricDeltaToneSchema>;

export const optimizationDetailRoundMetricCellSchema = z.object({
  label: z.string(),
  value: z.number(),
  partial: z.boolean().optional(),
  delta: z
    .object({
      value: z.number(),
      vsLabel: z.string(),
      tone: optimizationDetailMetricDeltaToneSchema,
      betterIsLower: z.boolean().optional(),
    })
    .optional(),
});
export type OptimizationDetailRoundMetricCellDto = z.infer<typeof optimizationDetailRoundMetricCellSchema>;

export const optimizationDetailMetricComparisonSchema = z.object({
  value: z.number(),
  vsLabel: z.string(),
  tone: optimizationDetailMetricDeltaToneSchema,
  betterIsLower: z.boolean().optional(),
});
export type OptimizationDetailMetricComparisonDto = z.infer<typeof optimizationDetailMetricComparisonSchema>;

export const optimizationDetailRoundMetricComparisonsSchema = z
  .object({
    accuracy: optimizationDetailMetricComparisonSchema.optional(),
    precision: optimizationDetailMetricComparisonSchema.optional(),
    recall: optimizationDetailMetricComparisonSchema.optional(),
  })
  .optional();
export type OptimizationDetailRoundMetricComparisonsDto = z.infer<
  typeof optimizationDetailRoundMetricComparisonsSchema
>;

export const optimizationDetailRoundClassRowSchema = z.object({
  label: z.string(),
  accuracy: z.number().optional(),
  precision: z.number(),
  recall: z.number(),
  f1: z.number().optional(),
  fpr: z.number().optional(),
  vsLabel: z.string(),
  vsDelta: z.number().nullable(),
  vsTone: optimizationDetailMetricDeltaToneSchema,
  deltas: optimizationDetailRoundMetricComparisonsSchema,
});
export type OptimizationDetailRoundClassRowDto = z.infer<typeof optimizationDetailRoundClassRowSchema>;

export const optimizationDetailRoundOverallRowSchema = z.object({
  accuracy: z.number(),
  precision: z.number(),
  recall: z.number(),
  vsLabel: z.string(),
  vsDelta: z.number().nullable(),
  vsTone: optimizationDetailMetricDeltaToneSchema,
  deltas: optimizationDetailRoundMetricComparisonsSchema,
});
export type OptimizationDetailRoundOverallRowDto = z.infer<typeof optimizationDetailRoundOverallRowSchema>;

export const optimizationDetailRoundGoalChipAchievedSchema = z.enum(['hit', 'miss']);
export type OptimizationDetailRoundGoalChipAchievedDto = z.infer<
  typeof optimizationDetailRoundGoalChipAchievedSchema
>;

export const optimizationDetailRoundGoalChipSchema = z.object({
  label: z.string(),
  targetText: z.string(),
  currentText: z.string(),
  achieved: optimizationDetailRoundGoalChipAchievedSchema,
});
export type OptimizationDetailRoundGoalChipDto = z.infer<typeof optimizationDetailRoundGoalChipSchema>;

export const optimizationDetailRoundErrorPatternSchema = z.object({
  percent: z.number(),
  title: z.string(),
  detail: z.string(),
  count: z.object({
    hit: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
});
export type OptimizationDetailRoundErrorPatternDto = z.infer<typeof optimizationDetailRoundErrorPatternSchema>;

export const optimizationDetailRoundImprovementPrioritySchema = z.enum(['high', 'medium', 'low']);
export type OptimizationDetailRoundImprovementPriorityDto = z.infer<
  typeof optimizationDetailRoundImprovementPrioritySchema
>;

export const optimizationDetailRoundImprovementSuggestionSchema = z.object({
  section: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  priority: optimizationDetailRoundImprovementPrioritySchema.optional(),
});
export type OptimizationDetailRoundImprovementSuggestionDto = z.infer<
  typeof optimizationDetailRoundImprovementSuggestionSchema
>;

export const optimizationDetailRoundExperimentResultSchema = z.object({
  experimentRef: z.string(),
  experimentStatus: z.enum(['running', 'success', 'failed']),
  samplesDone: z.number().int().nonnegative(),
  samplesTotal: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  elapsed: z.string(),
  tokenSummary: z.string(),
  costLabel: z.string(),
  overallRow: optimizationDetailRoundOverallRowSchema.nullable(),
  classRows: z.array(optimizationDetailRoundClassRowSchema),
  vsPrevLabel: z.string(),
});
export type OptimizationDetailRoundExperimentResultDto = z.infer<
  typeof optimizationDetailRoundExperimentResultSchema
>;

export const optimizationDetailRoundStreamSegmentSchema = z.object({
  kind: z.enum(['observation', 'hypothesis', 'rewrite', 'plain']),
  text: z.string(),
});
export type OptimizationDetailRoundStreamSegmentDto = z.infer<typeof optimizationDetailRoundStreamSegmentSchema>;

export const optimizationDetailRoundStreamSchema = z.object({
  stage: z.string(),
  analysisModel: z.string(),
  segments: z.array(optimizationDetailRoundStreamSegmentSchema),
  showCursor: z.boolean(),
});
export type OptimizationDetailRoundStreamDto = z.infer<typeof optimizationDetailRoundStreamSchema>;

export const optimizationDetailPromptDiffLineSchema = z.object({
  kind: z.enum(['hunk', 'add', 'del', 'ctx']),
  text: z.string(),
  lineNumber: z.number().int().positive().nullable().optional(),
});
export type OptimizationDetailPromptDiffLineDto = z.infer<typeof optimizationDetailPromptDiffLineSchema>;

// 每轮分步状态:与 ph_runs.optimization_round_steps 一一对应。
// 详情页 stepper 据此渲染圆点与"本步错误"banner;详见 docs/specs/25-optimizations.md §12。
export const optimizationDetailRoundStepKindSchema = z.enum(['error_analysis', 'generate_prompt', 'experiment']);
export type OptimizationDetailRoundStepKindDto = z.infer<typeof optimizationDetailRoundStepKindSchema>;

export const optimizationDetailRoundStepStatusSchema = z.enum(['pending', 'running', 'success', 'failed', 'skipped']);
export type OptimizationDetailRoundStepStatusDto = z.infer<typeof optimizationDetailRoundStepStatusSchema>;

export const optimizationDetailRoundStepSchema = z.object({
  step: optimizationDetailRoundStepKindSchema,
  status: optimizationDetailRoundStepStatusSchema,
  errorClass: z.string().nullable().optional(),
  errorMessage: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional(),
  runResultId: z.string().uuid().nullable().optional(),
  experimentId: z.string().uuid().nullable().optional(),
});
export type OptimizationDetailRoundStepDto = z.infer<typeof optimizationDetailRoundStepSchema>;

export const optimizationDetailIterationRoundSchema = z.object({
  index: z.number().int().nonnegative(),
  status: z.enum(['running', 'success', 'failed', 'paused']),
  isBaseline: z.boolean().optional(),
  isBest: z.boolean().optional(),
  kindLabel: z.string(),
  startedAt: z.string().optional(),
  metrics: z.array(optimizationDetailRoundMetricCellSchema),
  experimentResult: optimizationDetailRoundExperimentResultSchema.optional(),
  errorPatterns: z.array(optimizationDetailRoundErrorPatternSchema).optional(),
  improvementSuggestions: z.array(optimizationDetailRoundImprovementSuggestionSchema).optional(),
  promptDiff: z
    .object({
      from: z.string(),
      to: z.string(),
      fromText: z.string(),
      toText: z.string(),
      lines: z.array(optimizationDetailPromptDiffLineSchema),
    })
    .optional(),
  stream: optimizationDetailRoundStreamSchema.optional(),
  summaryFallback: z.string().optional(),
  collapsed: z.boolean().optional(),
  promptVersionId: z.string().uuid().nullable().optional(),
  experimentId: z.string().uuid().nullable().optional(),
  promptLink: z.string().optional(),
  experimentLink: z.string().optional(),
  totalElapsed: z.string().optional(),
  totalCost: z.string().optional(),
  // 三步状态 — Phase B 起每轮一开始即可见(experiments 行尚未创建时也已有 round_steps)。
  // 老 mock 数据(devMockTimeline.rounds)无 steps 字段,default([]) 保证 safeParse 兼容。
  steps: z.array(optimizationDetailRoundStepSchema).default([]),
  // 每轮优化目标 chip:右上角紧凑展示"目标 vs 当前轮"。
  // mock 数据(devMockTimeline.rounds)旧版无此字段,default([]) 保证 safeParse 兼容。
  goalChips: z.array(optimizationDetailRoundGoalChipSchema).default([]),
  // SPEC 25 §11: LLM 多次未保留 base 已用占位时,generate 在 newPromptBody 末尾自动补回缺失占位。
  // 设为 true 时前端轮次卡片显示"系统补丁" chip 提醒用户人工微调占位融入位置。
  autoPatched: z.boolean().optional(),
  patchedVariables: z.array(z.string()).optional(),
});
export type OptimizationDetailIterationRoundDto = z.infer<typeof optimizationDetailIterationRoundSchema>;

export const optimizationDetailBaselineMetricSchema = z.object({
  label: z.string(),
  value: z.number(),
  betterIsLower: z.boolean().optional(),
});
export type OptimizationDetailBaselineMetricDto = z.infer<typeof optimizationDetailBaselineMetricSchema>;

export const optimizationDetailBaselineRowSchema = z.object({
  promptVersion: z.string(),
  baselineExperiment: z.string(),
  metrics: z.array(optimizationDetailBaselineMetricSchema),
  promptPreview: z.string().nullable().optional(),
  experimentResult: optimizationDetailRoundExperimentResultSchema.optional(),
});
export type OptimizationDetailBaselineRowDto = z.infer<typeof optimizationDetailBaselineRowSchema>;

export const optimizationDetailGoalProgressAchievedSchema = z.enum(['hit', 'miss', 'critical']);
export type OptimizationDetailGoalProgressAchievedDto = z.infer<typeof optimizationDetailGoalProgressAchievedSchema>;

export const optimizationDetailGoalProgressSchema = z.object({
  label: z.string(),
  targetText: z.string(),
  currentText: z.string(),
  achieved: optimizationDetailGoalProgressAchievedSchema,
  percent: z.number().min(0).max(100),
});
export type OptimizationDetailGoalProgressDto = z.infer<typeof optimizationDetailGoalProgressSchema>;

export const optimizationDetailBestVersionMetricSchema = z.object({
  label: z.string(),
  value: z.number(),
  tone: optimizationDetailMetricDeltaToneSchema.optional(),
});
export type OptimizationDetailBestVersionMetricDto = z.infer<typeof optimizationDetailBestVersionMetricSchema>;

export const optimizationDetailBestVersionSchema = z.object({
  promptRef: z.string(),
  promptVersion: z.string(),
  generatedAtRoundLabel: z.string(),
  generatedAtRoundIndex: z.number().int().nullable().optional(),
  metrics: z.array(optimizationDetailBestVersionMetricSchema),
  experimentRef: z.string(),
  promptVersionId: z.string().uuid().nullable().optional(),
  experimentId: z.string().uuid().nullable().optional(),
});
export type OptimizationDetailBestVersionDto = z.infer<typeof optimizationDetailBestVersionSchema>;

export const optimizationDetailTrendSeriesKeySchema = z.enum(['accuracy', 'recall', 'fpr']);
export type OptimizationDetailTrendSeriesKeyDto = z.infer<typeof optimizationDetailTrendSeriesKeySchema>;

export const optimizationDetailTrendSeriesSchema = z.object({
  key: optimizationDetailTrendSeriesKeySchema,
  labelKey: z.string(),
  betterIsLower: z.boolean().optional(),
  values: z.array(z.number()),
  target: z.number().optional(),
  bestRoundIndex: z.number().int().nonnegative().optional(),
  hasBaseline: z.boolean().optional(),
});
export type OptimizationDetailTrendSeriesDto = z.infer<typeof optimizationDetailTrendSeriesSchema>;

export const optimizationDetailSchema = optimizationListItemSchema.extend({
  optimizationHint: z.string().nullable(),
  ownerHandle: z.string(),
  elapsedMs: z.number().int().nonnegative().nullable(),
  experimentConfig: optimizationDetailExperimentConfigSchema.nullable(),
  iterationConfig: optimizationDetailIterationConfigSchema.nullable(),
  goalScope: optimizationDetailGoalScopeSchema,
  goalsLines: z.array(optimizationDetailGoalsLineSchema),
  controlStrip: optimizationDetailControlStripSchema.nullable(),
  trend: z.array(optimizationDetailTrendSeriesSchema),
  trendBaselineRef: z.number().nullable(),
  bestRoundLabel: z.string().nullable(),
  rounds: z.array(optimizationDetailIterationRoundSchema),
  baseline: optimizationDetailBaselineRowSchema.nullable(),
  goalProgress: z.array(optimizationDetailGoalProgressSchema),
  bestVersion: optimizationDetailBestVersionSchema.nullable(),
});
export type OptimizationDetailDto = z.infer<typeof optimizationDetailSchema>;

// Dev-only mock timeline carried inside optimizations.run_config.devMockTimeline.
// Workflow 落地后改从 run_results 真聚合,届时此字段废弃。详见 docs/specs/25-optimizations.md。
export const optimizationDevMockTimelineSchema = z.object({
  trend: z.array(optimizationDetailTrendSeriesSchema).optional(),
  trendBaselineRef: z.number().nullable().optional(),
  bestRoundLabel: z.string().nullable().optional(),
  controlStrip: optimizationDetailControlStripSchema.nullable().optional(),
  rounds: z.array(optimizationDetailIterationRoundSchema).optional(),
  baselineMetrics: z.array(optimizationDetailBaselineMetricSchema).optional(),
  goalProgress: z.array(optimizationDetailGoalProgressSchema).optional(),
  bestVersion: optimizationDetailBestVersionSchema.nullable().optional(),
});
export type OptimizationDevMockTimelineDto = z.infer<typeof optimizationDevMockTimelineSchema>;
