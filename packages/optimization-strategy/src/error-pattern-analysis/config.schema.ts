import { z } from 'zod';

export const errorPatternAnalysisConfigSchema = z.object({
  // 单个 batch 估算可吃下的输入 token 上限 — 超过则切批
  maxInputTokensPerBatch: z.number().int().positive().default(60_000),
  // analyze 各阶段输出 token 上限
  maxAnalysisOutputTokens: z.number().int().positive().default(4096),
  maxSummarizeOutputTokens: z.number().int().positive().default(4096),
  maxGenerationOutputTokens: z.number().int().positive().default(8192),
  temperature: z.number().min(0).max(2).default(0.3),
  // 混淆对取 TOP N
  topConfusionPairs: z.number().int().positive().default(5),
  // 每个混淆对最多送给 LLM 看的样本数
  maxSamplesPerConfusionPair: z.number().int().positive().default(8),
  // 回归样本最多送给 LLM 的数量（多则按 latest 截取）
  maxRegressionSamples: z.number().int().positive().default(20),
  // from_dataset_only 起点：分析 LLM 用多少样本生成初始提示词
  // — initialSamplingRounds 分多少轮独立采样后合成观察
  initialSamplingRounds: z.number().int().min(1).max(10).default(1),
  // — 每轮从数据集随机采样多少条
  initialSamplesPerRound: z.number().int().min(1).max(200).default(20),
});

export type ErrorPatternAnalysisConfig = z.infer<typeof errorPatternAnalysisConfigSchema>;

export const DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG: ErrorPatternAnalysisConfig =
  errorPatternAnalysisConfigSchema.parse({});
