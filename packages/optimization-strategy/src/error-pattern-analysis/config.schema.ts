import { z } from 'zod';

export const errorPatternAnalysisConfigSchema = z.object({
  // Maximum estimated input tokens a single batch can absorb — over this triggers batch splitting
  maxInputTokensPerBatch: z.number().int().positive().default(60_000),
  // Output token caps at each analyze stage
  maxAnalysisOutputTokens: z.number().int().positive().default(4096),
  maxSummarizeOutputTokens: z.number().int().positive().default(4096),
  maxGenerationOutputTokens: z.number().int().positive().default(8192),
  temperature: z.number().min(0).max(2).default(0.3),
  // Take TOP N confusion pairs
  topConfusionPairs: z.number().int().positive().default(5),
  // Maximum number of samples per confusion pair sent to the LLM
  maxSamplesPerConfusionPair: z.number().int().positive().default(8),
  // Maximum number of regression samples sent to the LLM (truncated by latest if more)
  maxRegressionSamples: z.number().int().positive().default(20),
  // from_dataset_only start: how many samples the analysis LLM uses to generate the initial prompt
  // — initialSamplingRounds: how many independent sampling rounds are combined into observations
  initialSamplingRounds: z.number().int().min(1).max(10).default(1),
  // — how many records to randomly sample from the dataset per round
  initialSamplesPerRound: z.number().int().min(1).max(200).default(20),
});

export type ErrorPatternAnalysisConfig = z.infer<typeof errorPatternAnalysisConfigSchema>;

export const DEFAULT_ERROR_PATTERN_ANALYSIS_CONFIG: ErrorPatternAnalysisConfig =
  errorPatternAnalysisConfigSchema.parse({});
