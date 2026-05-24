// 优化循环类型 — 详见 docs/specs/25-optimizations.md
import type {
  InvokeLLMDependencies,
  LLMAdapter,
  LLMCallLogger,
  ModelInvocationConfig,
  RateLimiterLike,
} from '@proofhound/llm-client';
import type { PromptLanguageDto } from '@proofhound/shared';
import type { ProjectType } from '../types';

export type ComparisonOp = '>=' | '<=' | '>';

export interface OptimizationGoal {
  metric: string;
  op: ComparisonOp;
  value: number;
  scope: { kind: 'overall' } | { kind: 'class'; label: string };
}

export interface MetricSnapshot {
  overall: Record<string, number>;
  perClass?: Record<string, Record<string, number>>;
}

export interface JudgmentRuleSet {
  ruleName: string;
  config: unknown;
}

export interface PromptVariable {
  name: string;
  description?: string;
}

export interface PromptVersionRef {
  id: string;
  promptId: string;
  versionNumber: number;
  body: string;
  outputSchema?: unknown;
  promptLanguage?: PromptLanguageDto;
  judgmentRules?: JudgmentRuleSet;
  variables?: PromptVariable[];
}

export interface SampleRecord {
  id: string;
  input: Record<string, unknown>;
  expected?: unknown;
}

export interface RunResultRecord {
  id: string;
  sampleId: string;
  parsedOutput?: unknown;
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  errorMessage?: string | null;
  rawResponse?: string | null;
}

export interface ExperimentSnapshot {
  projectId: string;
  projectType: ProjectType;
  sourceExperimentId: string;
  dataset: { id: string; samples: SampleRecord[] };
  taskModel: ModelInvocationConfig;
  judgmentRules: JudgmentRuleSet;
  basePromptVersion: PromptVersionRef;
  lastRunResults: RunResultRecord[];
  lastMetrics: MetricSnapshot;
}

// 字段白名单 — 三类用途分开表达
// - promptVariables: 可作为 {{var}} 进入最终 prompt 的字段；新版本不能引入此列表外的变量
// - analysisOnlyFields: 仅供分析 LLM 阅读，禁止进入最终 prompt
// - modifiableSections: 生成阶段允许修改的 prompt 段（标题 / 任务说明 / 示例区等）
export interface FieldWhitelist {
  promptVariables: string[];
  analysisOnlyFields?: string[];
  modifiableSections?: string[];
}

export interface OptimizationConfig<TStrategyConfig = unknown> {
  optimizationId: string;
  goals: OptimizationGoal[];
  maxRounds: number;
  fieldWhitelist: FieldWhitelist;
  analysisModel: ModelInvocationConfig;
  taskModel: ModelInvocationConfig;
  strategyKey: 'error_pattern_analysis';
  strategyConfig: TStrategyConfig;
  // 用户在创建优化时的额外指导（自然语言提示）— 透传到 generate 的 user prompt
  optimizationHint?: string;
  promptLanguage?: PromptLanguageDto;
}

export interface GoalProgressEntry {
  goal: OptimizationGoal;
  achieved: boolean;
  observed: number | null;
}

export interface RoundOutcome {
  roundNumber: number;
  generatedVersionId: string;
  errorAnalysis: string;
  changeSummary: string;
  experimentId: string;
  runResults: RunResultRecord[];
  metrics: MetricSnapshot;
  isBest: boolean;
  goalProgress: GoalProgressEntry[];
  startedAt: string;
  finishedAt: string;
}

// 跨轮历史快照 — 注入到非首轮的 analyze / generate LLM 调用，
// 让 LLM 感知已尝试过的方向 + 效果，避免重复无效改动。详见 docs/specs/25-optimizations.md §11.3
export interface RoundHistoryAppliedChange {
  changeId: string;
  patternIds?: string[];
  rationale?: string;
}

export interface RoundHistoryEntry {
  roundIndex: number;
  metrics: MetricSnapshot;
  deltaFromPrev: number | null;
  changeSummary: string;
  appliedChanges: RoundHistoryAppliedChange[];
  // 本轮 generate LLM 自报的「借鉴的优化技巧」(对应 optimization-tips.md 工具箱条目);
  // 连续 ≥2 轮 !isBest 时用于在下一轮 generate user prompt 注入「工具箱轮换提示」段。
  // 解析失败 / 旧数据回退 []。详见 docs/specs/25 §11.3「工具箱轮换提示」
  appliedTips: string[];
  isBest: boolean;
  generatedFromBaseVersionId: string;
}

export type OptimizationStatus = 'success' | 'failed' | 'stopped' | 'cancelled';

export type OptimizationReason = 'goals_met' | 'max_rounds' | 'control_stop' | 'control_cancel' | 'fatal_error';

export interface OptimizationResult {
  status: OptimizationStatus;
  reason: OptimizationReason;
  bestVersionId: string;
  bestMetrics: MetricSnapshot;
  rounds: RoundOutcome[];
  errorClass?: string;
  errorMessage?: string;
}

export interface ExperimentRunnerInput {
  optimizationId: string;
  versionId: string;
  datasetId: string;
  taskModel: ModelInvocationConfig;
  judgmentRules: JudgmentRuleSet;
  roundNumber: number;
}

export interface ExperimentRunnerOutput {
  experimentId: string;
  runResults: RunResultRecord[];
  metrics: MetricSnapshot;
}

export interface ExperimentRunnerPort {
  runExperiment(input: ExperimentRunnerInput): Promise<ExperimentRunnerOutput>;
}

export interface PromptVersionWriteInput {
  promptId: string;
  parentVersionId: string;
  body: string;
  outputSchema?: unknown;
  judgmentRules?: JudgmentRuleSet;
  optimizationId: string;
  changeSummary: string;
}

export interface PromptVersionWriterPort {
  writePromptVersion(input: PromptVersionWriteInput): Promise<PromptVersionRef>;
}

export interface RoundRecorderPort {
  recordRound(round: RoundOutcome, ctx: { optimizationId: string }): Promise<void>;
  recordFinal(result: OptimizationResult, ctx: { optimizationId: string }): Promise<void>;
}

export type ControlSignal = 'stop' | 'resume' | 'cancel' | null;

export interface ControlSignalReader {
  read(optimizationId: string): Promise<ControlSignal>;
}

// 回归样本检测需要"上一轮"实验的 run results
// - 第 1 轮：read({currentRoundNumber: 1}) 应返回源实验最后一轮的 run results
// - 第 N≥2 轮：返回第 N-1 轮 optimization 实验的 run results
// 返回 null 表示无可比对的上一轮（此时跳过 regression 分析）
export interface PreviousRoundReadInput {
  optimizationId: string;
  sourceExperimentId: string;
  currentRoundNumber: number;
}
export interface PreviousRoundRunResultsReaderPort {
  read(input: PreviousRoundReadInput): Promise<RunResultRecord[] | null>;
}

export interface LoopPorts {
  experimentRunner: ExperimentRunnerPort;
  promptVersionWriter: PromptVersionWriterPort;
  roundRecorder: RoundRecorderPort;
  controlSignals: ControlSignalReader;
  previousRoundRunResultsReader: PreviousRoundRunResultsReaderPort;
}

export interface LoopDependencies {
  // 注入到 invokeLLM 的 LLM adapter — 不传则走 llm-client 默认（生产用 anthropic/openai/azure）
  llmAdapter?: LLMAdapter;
  limiter: RateLimiterLike;
  logger: LLMCallLogger;
  now?: () => number;
}

// 内部辅助：把 LoopDependencies 装成 invokeLLM 用的 dependencies — analyze/generate 共享
export function toInvokeLLMDependencies(deps: LoopDependencies): InvokeLLMDependencies {
  return {
    limiter: deps.limiter,
    logger: deps.logger,
    adapters: deps.llmAdapter ? [deps.llmAdapter] : undefined,
    now: deps.now,
  };
}
