// 错误样本分析 — 混淆对 + 回归 + 多次 LLM 调用 + LLM 二次汇总
// Token 预算：每次 LLM 调用前用 estimateMessagesTokens 估 baseline；超 maxInputTokensPerBatch 时降级
// （fitSamplesToBudget → 字段截断 → batch 数砍）
import {
  invokeLLM,
  type InvokeLLMDependencies,
  type LLMMessage,
  type ModelInvocationConfig,
  type RunResultContext,
} from '@proofhound/llm-client';
import type {
  OptimizationGoal,
  FieldWhitelist,
  MetricSnapshot,
  PromptVersionRef,
  RoundHistoryEntry,
  RunResultRecord,
  SampleRecord,
} from '../loop/types';
import type { ErrorPatternAnalysisConfig } from './config.schema';
import {
  buildConfusionPairs,
  buildRegressionGroups,
  type ConfusionPair,
  type RegressionGroup,
  type SampleView,
} from './confusion-pairs';
import {
  buildAnalyzeConfusionMessages,
  buildAnalyzeRegressionMessages,
  buildSummarizeMessages,
  fitRoundHistoryToBudget,
} from './prompts';
import {
  normalizeEvidenceBundle,
  parseConfusionAnalysisOutput,
  parseRegressionAnalysisOutput,
  parseSummarizeOutput,
  type AnalysisEvidenceBundle,
  type AnalysisPattern,
  type SuggestedChange,
  type SummarizeOutput,
} from './parse';
import {
  computeSampleBudget,
  estimateMessagesTokens,
  estimateTokens,
  fitSamplesToBudget,
  truncateAllStringFieldsInObject,
  truncateStringFields,
} from './token-budget';
import { DEFAULT_PROMPT_LANGUAGE, type PromptLanguageDto } from '@proofhound/shared';

// 优化每轮 1 行 analysis + 1 行 generate 落 ph_runs.run_results(SPEC 25 §11.2)。
// 由 workflow 提供确定性 runResultId(uuidv5)与 meta(projectId / sourceId=optimizationId /
// promptVersionId / modelId / dbosWorkflowId / attempt)。analysis 行只在最终 summarize 那次写——
// 中间 confusion / regression 多次 batch 调用是实现细节,只走应用日志,不写 run_results。
export interface OptimizationRunResultMeta {
  projectId: string;
  sourceId: string;
  promptVersionId: string;
  modelId: string;
  dbosWorkflowId?: string | null;
  bullmqJobId?: string | null;
  attempt?: number;
}

export interface AnalyzeFailuresArgs {
  optimizationId: string;
  roundNumber: number;
  analysisModel: ModelInvocationConfig;
  currentVersion: PromptVersionRef;
  previousVersion?: PromptVersionRef | null;
  samples: SampleRecord[];
  currentRunResults: RunResultRecord[];
  previousRunResults: RunResultRecord[] | null;
  metrics: MetricSnapshot;
  goals: OptimizationGoal[];
  fieldWhitelist: FieldWhitelist;
  strategyConfig: ErrorPatternAnalysisConfig;
  promptLanguage?: PromptLanguageDto;
  // 跨轮历史(SPEC 25 §11.3)：非首轮时由 caller 聚合传入；首轮 undefined / [] 不渲染历史段
  roundHistory?: RoundHistoryEntry[];
  // 提供时,summarize 阶段 invokeLLM 会自动写 ph_runs.run_results 一行(source='optimization_analysis')。
  // 不传则维持旧行为(只打日志,不写表),向后兼容单测 / 离线脚本。
  runResultMeta?: OptimizationRunResultMeta;
  analysisRunResultId?: string;
}

// 降级动作记录 — 出现在 batch 上，便于诊断哪些样本 / batch 被截了
export interface BatchBudgetReport {
  baselineInputTokens: number;
  sampleBudgetTokens: number;
  estimatedSampleTokens: number;
  originalSampleCount: number;
  fittedSampleCount: number;
  droppedSampleCount: number;
  fieldsTruncated: boolean; // 单条都塞不下时启动字段截断
}

export interface AnalyzeBatchRecord {
  source: 'confusion' | 'regression';
  title: string;
  llmTruncated: boolean;
  errorPatterns: AnalysisPattern[];
  suggestedChanges: SuggestedChange[];
  rawContent: string;
  budget: BatchBudgetReport;
}

export interface SummarizeBudgetReport {
  baselineInputTokens: number;
  estimatedBatchesTokens: number;
  fieldTruncationApplied: boolean; // 阶段 1 降级：截 batch 内长字段
  droppedBatchCount: number; // 阶段 2 降级：砍掉的 batch 数
}

export interface AnalyzeFailuresResult {
  errorAnalysisText: string;
  summary: SummarizeOutput;
  evidenceBundle?: AnalysisEvidenceBundle;
  batches: AnalyzeBatchRecord[];
  confusionPairs: ConfusionPair[];
  regressionGroups: RegressionGroup[];
  truncated: boolean;
  totalConfusionFailures: number;
  totalRegressionSamples: number;
  summarizeBudget?: SummarizeBudgetReport;
}

export async function analyzeFailures(
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeFailuresResult> {
  const promptLanguage = args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE;
  // 跨轮历史 token budget 降级 — 给所有 batch 用同一份 fitted history,避免重复 estimate
  // history 最多占用 batch input budget 的 40%,其余留给错误样本 + evidence
  const historyCap = Math.floor(args.strategyConfig.maxInputTokensPerBatch * 0.4);
  const fittedHistoryResult = fitRoundHistoryToBudget(args.roundHistory, historyCap, args.goals, promptLanguage);
  const argsWithFittedHistory: AnalyzeFailuresArgs = {
    ...args,
    promptLanguage,
    roundHistory: fittedHistoryResult.fitted,
  };

  const confusionPairs = buildConfusionPairs({
    runResults: args.currentRunResults,
    samples: args.samples,
    whitelist: args.fieldWhitelist,
    topN: args.strategyConfig.topConfusionPairs,
    maxSamplesPerPair: args.strategyConfig.maxSamplesPerConfusionPair,
  });

  const regressionGroups = buildRegressionGroups({
    currentRunResults: args.currentRunResults,
    previousRunResults: args.previousRunResults,
    samples: args.samples,
    whitelist: args.fieldWhitelist,
    maxSamples: args.strategyConfig.maxRegressionSamples,
  });

  const totalConfusionFailures = confusionPairs.reduce((sum, p) => sum + p.count, 0);
  const totalRegressionSamples = regressionGroups.reduce((sum, g) => sum + g.count, 0);

  const batches: AnalyzeBatchRecord[] = [];
  let anyTruncated = false;

  for (const pair of confusionPairs) {
    const batch = await runConfusionBatch(pair, argsWithFittedHistory, deps);
    batches.push(batch);
    if (batch.llmTruncated) anyTruncated = true;
  }

  for (const group of regressionGroups) {
    const batch = await runRegressionBatch(group, argsWithFittedHistory, deps);
    batches.push(batch);
    if (batch.llmTruncated) anyTruncated = true;
  }

  const { summary, budget: summarizeBudget } = await runSummarize(argsWithFittedHistory, batches, deps, {
    totalConfusionFailures,
    totalRegressionSamples,
    truncated: anyTruncated,
  });
  if (summary.truncated) anyTruncated = true;
  const evidenceBundle = buildAnalysisEvidenceBundle(summary, batches, {
    totalConfusionFailures,
    totalRegressionSamples,
    truncated: anyTruncated,
  });

  return {
    errorAnalysisText: summary.summary,
    summary,
    evidenceBundle,
    batches,
    confusionPairs,
    regressionGroups,
    truncated: anyTruncated,
    totalConfusionFailures,
    totalRegressionSamples,
    summarizeBudget,
  };
}

// 极端情况下"一条样本本身就超 budget"时的字段截断阈值（chars，按 4 chars/token 反算）
const PER_FIELD_TRUNCATE_CHARS = 2_000;

interface FitOutcome {
  fitted: SampleView[];
  dropped: SampleView[];
  baseline: number;
  fieldsTruncated: boolean;
  sampleBudget: number;
  estimatedSampleTokens: number;
}

// confusion + regression 两条分析路径的公共流水线:
// fit 出来的样本 → buildMessages → invokeLLM → parse → normalizeEvidenceBundle → AnalyzeBatchRecord
// 差异只通过 spec 注入（source / bucketKey / 已 fit 好的样本 / messages builder / parser /
// stepName / requestKey）。业务行为(LLM 调用次数、messages 内容、最终字段)不变。
interface AnalysisBatchSpec {
  source: 'confusion' | 'regression';
  bucketKey: string;
  fitResult: FitOutcome;
  originalSampleCount: number;
  affectedCountFallback: number;
  buildMessages: () => { system: string; user: string };
  parseOutput: (
    content: string,
    finishReason: string | null | undefined,
  ) => {
    errorPatterns: AnalysisPattern[];
    suggestedChanges: SuggestedChange[];
    truncated: boolean;
    rawContent: string;
  };
  stepName: 'error_pattern_analyze_confusion' | 'error_pattern_analyze_regression';
  requestKey: string;
}

async function runAnalysisBatch(
  spec: AnalysisBatchSpec,
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeBatchRecord> {
  const { system, user } = spec.buildMessages();
  const result = await invokeLLM(
    {
      model: args.analysisModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      params: {
        temperature: args.strategyConfig.temperature,
        maxTokens: args.strategyConfig.maxAnalysisOutputTokens,
      },
      context: {
        source: 'optimization_analysis',
        stepName: spec.stepName,
        requestId: `optimization:${args.optimizationId}:r${args.roundNumber}:${spec.source}:${spec.requestKey}`,
        promptVersionId: args.currentVersion.id,
        promptLanguage: args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE,
      },
    },
    deps,
  );
  const parsed = spec.parseOutput(result.content, result.finishReason);
  const { errorPatterns, suggestedChanges } = normalizeEvidenceBundle(
    { errorPatterns: parsed.errorPatterns, suggestedChanges: parsed.suggestedChanges },
    {
      source: spec.source,
      bucketKey: spec.bucketKey,
      affectedCountFallback: spec.affectedCountFallback,
    },
  );
  return {
    source: spec.source,
    title: `${spec.source}: ${spec.bucketKey}`,
    llmTruncated: parsed.truncated,
    errorPatterns,
    suggestedChanges,
    rawContent: parsed.rawContent,
    budget: {
      baselineInputTokens: spec.fitResult.baseline,
      sampleBudgetTokens: spec.fitResult.sampleBudget,
      estimatedSampleTokens: spec.fitResult.estimatedSampleTokens,
      originalSampleCount: spec.originalSampleCount,
      fittedSampleCount: spec.fitResult.fitted.length,
      droppedSampleCount: spec.fitResult.dropped.length,
      fieldsTruncated: spec.fitResult.fieldsTruncated,
    },
  };
}

async function runConfusionBatch(
  pair: ConfusionPair,
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeBatchRecord> {
  const fitResult = fitSamplesForConfusion(pair, args);
  const trimmedPair: ConfusionPair = { ...pair, samples: fitResult.fitted };
  return runAnalysisBatch(
    {
      source: 'confusion',
      bucketKey: `${pair.expected}→${pair.predicted}`,
      fitResult,
      originalSampleCount: pair.samples.length,
      affectedCountFallback: pair.count,
      buildMessages: () =>
        buildAnalyzeConfusionMessages({
          pair: trimmedPair,
          currentVersion: args.currentVersion,
          metrics: args.metrics,
          goals: args.goals,
          fieldWhitelist: args.fieldWhitelist,
          roundHistory: args.roundHistory,
          promptLanguage: args.promptLanguage,
        }),
      parseOutput: parseConfusionAnalysisOutput,
      stepName: 'error_pattern_analyze_confusion',
      requestKey: `${pair.expected}_to_${pair.predicted}`,
    },
    args,
    deps,
  );
}

function fitSamplesForConfusion(pair: ConfusionPair, args: AnalyzeFailuresArgs): FitOutcome {
  // 1) 探针：把 samples 清空构造一次 message，估固定开销（含已 fit 的跨轮历史）
  const probePair: ConfusionPair = { ...pair, samples: [] };
  const probe = buildAnalyzeConfusionMessages({
    pair: probePair,
    currentVersion: args.currentVersion,
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxAnalysisOutputTokens);
  const sampleBudget = computeSampleBudget(args.strategyConfig.maxInputTokensPerBatch, baseline.inputTokens);

  // 2) fit
  let { fitted, dropped, estimatedTokens } = fitSamplesToBudget(pair.samples, sampleBudget, 0);

  // 3) 没塞下任何样本但确实有样本 → 强行塞 1 条且对其字段做暴力截断
  let fieldsTruncated = false;
  if (fitted.length === 0 && pair.samples.length > 0) {
    const head = pair.samples[0]!;
    const truncated = truncateStringFields(head, PER_FIELD_TRUNCATE_CHARS);
    fitted = [truncated];
    dropped = pair.samples.slice(1);
    estimatedTokens = estimateTokens(truncated);
    fieldsTruncated = true;
  }

  return {
    fitted,
    dropped,
    baseline: baseline.inputTokens,
    fieldsTruncated,
    sampleBudget,
    estimatedSampleTokens: estimatedTokens,
  };
}

async function runRegressionBatch(
  group: RegressionGroup,
  args: AnalyzeFailuresArgs,
  deps: InvokeLLMDependencies,
): Promise<AnalyzeBatchRecord> {
  const fitResult = fitSamplesForRegression(group, args);
  const trimmedGroup: RegressionGroup = { ...group, samples: fitResult.fitted };
  return runAnalysisBatch(
    {
      source: 'regression',
      bucketKey: `predicted=${group.predicted}`,
      fitResult,
      originalSampleCount: group.samples.length,
      affectedCountFallback: group.count,
      buildMessages: () =>
        buildAnalyzeRegressionMessages({
          group: trimmedGroup,
          currentVersion: args.currentVersion,
          previousVersion: args.previousVersion,
          metrics: args.metrics,
          goals: args.goals,
          fieldWhitelist: args.fieldWhitelist,
          roundHistory: args.roundHistory,
          promptLanguage: args.promptLanguage,
        }),
      parseOutput: parseRegressionAnalysisOutput,
      stepName: 'error_pattern_analyze_regression',
      requestKey: group.predicted,
    },
    args,
    deps,
  );
}

function fitSamplesForRegression(group: RegressionGroup, args: AnalyzeFailuresArgs): FitOutcome {
  const probeGroup: RegressionGroup = { ...group, samples: [] };
  const probe = buildAnalyzeRegressionMessages({
    group: probeGroup,
    currentVersion: args.currentVersion,
    previousVersion: args.previousVersion,
    metrics: args.metrics,
    goals: args.goals,
    fieldWhitelist: args.fieldWhitelist,
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxAnalysisOutputTokens);
  const sampleBudget = computeSampleBudget(args.strategyConfig.maxInputTokensPerBatch, baseline.inputTokens);

  let { fitted, dropped, estimatedTokens } = fitSamplesToBudget(group.samples, sampleBudget, 0);

  let fieldsTruncated = false;
  if (fitted.length === 0 && group.samples.length > 0) {
    const head = group.samples[0]!;
    const truncated = truncateStringFields(head, PER_FIELD_TRUNCATE_CHARS);
    fitted = [truncated];
    dropped = group.samples.slice(1);
    estimatedTokens = estimateTokens(truncated);
    fieldsTruncated = true;
  }

  return {
    fitted,
    dropped,
    baseline: baseline.inputTokens,
    fieldsTruncated,
    sampleBudget,
    estimatedSampleTokens: estimatedTokens,
  };
}

function buildAnalysisEvidenceBundle(
  summary: SummarizeOutput,
  batches: AnalyzeBatchRecord[],
  stats: {
    totalConfusionFailures: number;
    totalRegressionSamples: number;
    truncated: boolean;
  },
): AnalysisEvidenceBundle {
  return {
    evidenceBundleVersion: 1,
    summary: summary.summary,
    errorPatterns: summary.errorPatterns,
    suggestedChanges: summary.suggestedChanges,
    conflicts: summary.conflicts ?? [],
    sourceStats: {
      batchCount: batches.length,
      totalConfusionFailures: stats.totalConfusionFailures,
      totalRegressionSamples: stats.totalRegressionSamples,
      truncated: stats.truncated || summary.truncated,
    },
  };
}

// summarize 字段截断的字符上限（按 batch 内 reason / change / rationale 这种长字段控制）
const SUMMARIZE_FIELD_TRUNCATE_CHARS = 600;

async function runSummarize(
  args: AnalyzeFailuresArgs,
  batches: AnalyzeBatchRecord[],
  deps: InvokeLLMDependencies,
  stats: {
    totalConfusionFailures: number;
    totalRegressionSamples: number;
    truncated: boolean;
  },
): Promise<{ summary: SummarizeOutput; budget: SummarizeBudgetReport | undefined }> {
  if (batches.length === 0) {
    const summary: SummarizeOutput = {
      summary:
        '本轮没有失败样本可供分析（confusion + regression 均为空）。建议直接继续下一轮，或检查实验是否真的执行了。',
      errorPatterns: [],
      suggestedChanges: [],
      conflicts: [],
      evidenceBundleVersion: 1,
      truncated: false,
      rawContent: '',
    };
    deps.logger.info(
      {
        optimizationId: args.optimizationId,
        roundNumber: args.roundNumber,
        reason: 'no_batches',
        confusionPairsCount: 0,
        regressionGroupsCount: 0,
        currentFailureCount: args.currentRunResults.filter((r) => r.isCorrect === false).length,
        currentRunResultsCount: args.currentRunResults.length,
        previousRunResultsCount: args.previousRunResults?.length ?? 0,
        hasPreviousRound: args.previousRunResults != null,
        samplesWithExpectedCount: args.samples.filter((s) => s.expected != null).length,
      },
      'analyze_skipped',
    );
    return {
      summary,
      budget: undefined,
    };
  }

  // 探针：空 batches 估 baseline（含已 fit 的跨轮历史）
  const probe = buildSummarizeMessages({
    goals: args.goals,
    metrics: args.metrics,
    collectedBatches: [],
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });
  const baseline = estimateMessagesTokens(probe.system, probe.user, args.strategyConfig.maxSummarizeOutputTokens);
  const budget = computeSampleBudget(args.strategyConfig.maxInputTokensPerBatch, baseline.inputTokens);

  // 计算原始 batches 的 token 占用
  const rawCollected = batches.map((b) => ({
    source: b.source,
    title: b.title,
    payload: { errorPatterns: b.errorPatterns, suggestedChanges: b.suggestedChanges },
  }));
  let collected = rawCollected;
  let fieldTruncationApplied = false;
  let droppedBatchCount = 0;
  let currentTokens = estimateTokens(collected);

  // 阶段 1：超 budget → 字段截断
  if (currentTokens > budget) {
    collected = rawCollected.map((b) => truncateAllStringFieldsInObject(b, SUMMARIZE_FIELD_TRUNCATE_CHARS));
    fieldTruncationApplied = true;
    currentTokens = estimateTokens(collected);
  }

  // 阶段 2：仍超 budget → 按 batch 砍（confusion 优先保留 = 排到前面）
  if (currentTokens > budget) {
    const sortedConfusionFirst = [...collected].sort((a, b) =>
      a.source === 'confusion' && b.source !== 'confusion'
        ? -1
        : a.source !== 'confusion' && b.source === 'confusion'
          ? 1
          : 0,
    );
    const kept: typeof collected = [];
    let used = 0;
    for (const b of sortedConfusionFirst) {
      const t = estimateTokens(b);
      if (used + t > budget && kept.length >= 1) {
        droppedBatchCount++;
        continue;
      }
      kept.push(b);
      used += t;
    }
    collected = kept;
    currentTokens = used;
  }

  const { system, user } = buildSummarizeMessages({
    goals: args.goals,
    metrics: args.metrics,
    collectedBatches: collected,
    roundHistory: args.roundHistory,
    promptLanguage: args.promptLanguage,
  });

  const messages: LLMMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];

  const result = await invokeLLM(
    {
      model: args.analysisModel,
      messages,
      params: {
        temperature: args.strategyConfig.temperature,
        maxTokens: args.strategyConfig.maxSummarizeOutputTokens,
      },
      context: {
        source: 'optimization_analysis',
        stepName: 'error_pattern_summarize',
        requestId: `optimization:${args.optimizationId}:r${args.roundNumber}:summarize`,
        promptVersionId: args.currentVersion.id,
      },
      runResult: buildRunResultForCall({
        meta: args.runResultMeta,
        runResultId: args.analysisRunResultId,
        source: 'optimization_analysis',
        roundIndex: args.roundNumber,
        messages,
        inputVariables: {
          optimizationId: args.optimizationId,
          roundNumber: args.roundNumber,
          stepName: 'error_pattern_summarize',
          promptLanguage: args.promptLanguage ?? DEFAULT_PROMPT_LANGUAGE,
        },
      }),
      // run_results.parsed_output 喂详情页 errorPatterns / suggestedChanges(SPEC 25 §11.3)；
      // finishReason 在外部重 parse 时才补,这里给 null 保证至少关键字段可用。
      parseResponse: (content) => {
        try {
          const parsed = parseSummarizeOutput(content, null);
          return {
            ...parsed,
            evidenceBundle: buildAnalysisEvidenceBundle(parsed, batches, stats),
          };
        } catch {
          return null;
        }
      },
    },
    deps,
  );

  return {
    summary: parseSummarizeOutput(result.content, result.finishReason),
    budget: {
      baselineInputTokens: baseline.inputTokens,
      estimatedBatchesTokens: currentTokens,
      fieldTruncationApplied,
      droppedBatchCount,
    },
  };
}

export type { ConfusionPair, RegressionGroup };

// 由 analyze / generate 调用 invokeLLM 时构造 RunResultContext。
// 只有当 caller 同时提供 meta 与 runResultId 时返回 context,否则返回 undefined
// (invokeLLM 内部按 `runResult && runResultWriter` 双 guard 决定是否写表)。
// roundIndex 必传:详情页 listOptimizationLlmRunResults 以 isNotNull(round_index) 过滤,
// 缺失即被吃掉(导致 errorPatterns / suggestedChanges / promptDiff 整体丢失)。
export function buildRunResultForCall(input: {
  meta: OptimizationRunResultMeta | undefined;
  runResultId: string | undefined;
  source: 'optimization_analysis' | 'optimization_generate';
  roundIndex: number;
  messages: LLMMessage[];
  inputVariables: Record<string, unknown>;
}): RunResultContext | undefined {
  if (!input.meta || !input.runResultId) return undefined;
  return {
    id: input.runResultId,
    projectId: input.meta.projectId,
    source: input.source,
    sourceId: input.meta.sourceId,
    promptVersionId: input.meta.promptVersionId,
    modelId: input.meta.modelId,
    sampleId: null,
    externalId: null,
    renderedPrompt: { messages: input.messages },
    inputVariables: input.inputVariables,
    expectedOutput: null,
    dbosWorkflowId: input.meta.dbosWorkflowId ?? null,
    bullmqJobId: input.meta.bullmqJobId ?? null,
    attempt: input.meta.attempt ?? 0,
    roundIndex: input.roundIndex,
  };
}
