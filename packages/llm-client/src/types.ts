import type { PromptLanguageDto } from '@proofhound/shared';

export type LLMSource =
  | 'experiment'
  | 'optimization_analysis'
  | 'optimization_generate'
  | 'release';
export type LLMRunStatus = 'success' | 'error' | 'timeout' | 'rate_limited';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<Record<string, unknown>>;
  name?: string;
  toolCallId?: string;
}

export interface LLMInferenceParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: unknown;
  responseFormat?: unknown;
  imageRefs?: unknown;
  imagePreprocess?: LLMImagePreprocessOptions | false;
  apiVersion?: string;
}

export interface LLMImagePreprocessOptions {
  maxEdgePixels?: number;
  maxOutputBytes?: number;
  maxInputBytes?: number;
  jpegQuality?: number;
  minJpegQuality?: number;
}

export interface ModelInvocationConfig {
  id: string;
  providerType: string;
  providerModelId: string;
  endpoint: string;
  apiKey: string;
  capabilities?: ModelInvocationCapabilities;
  rpmLimit: number;
  tpmLimit: number;
  concurrencyLimit: number;
  inputTokenPricePerMillion: number | string;
  outputTokenPricePerMillion: number | string;
  extraBody?: Record<string, unknown>;
}

export type ModelImageCapability = 'none' | 'url' | 'base64' | 'both';

export interface ModelInvocationCapabilities {
  image: ModelImageCapability;
}

export interface LLMCallContext {
  requestId?: string;
  dbosWorkflowId?: string;
  bullmqJobId?: string;
  bullmqQueue?: string;
  stepName?: string;
  runResultId?: string;
  promptId?: string;
  promptVersionId?: string;
  promptLanguage?: PromptLanguageDto;
  source?: LLMSource;
  attempt?: number;
}

export interface RunResultContext {
  id: string;
  projectId: string;
  source: LLMSource;
  sourceId: string;
  releaseVariantId?: string | null;
  promptVersionId: string;
  modelId: string;
  sampleId?: string | null;
  externalId?: string | null;
  renderedPrompt: unknown;
  inputVariables?: unknown;
  expectedOutput?: string | null;
  dbosWorkflowId?: string | null;
  bullmqJobId?: string | null;
  attempt: number;
  // 优化 LLM 调用专用:optimization_analysis / optimization_generate 的轮序号(0-based)。
  // 详情页 listOptimizationLlmRunResults 用 isNotNull(round_index) 过滤,缺失会导致整行被吃。
  roundIndex?: number | null;
}

export interface LLMJudgmentOutcome {
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: LLMJudgmentStatus | null;
}

export interface InvokeLLMArgs {
  model: ModelInvocationConfig;
  messages?: LLMMessage[];
  prompt?: string;
  params?: LLMInferenceParams;
  context?: LLMCallContext;
  runResult?: RunResultContext;
  timeoutMs?: number;
  /**
   * 单条样本的内部重试次数（对可重试 HTTP 状态 + 网络错误生效）。
   * 不影响 BullMQ job 级 attempts；RateLimitExceededError 透传不被吞。
   * 缺省 0（向后兼容）。
   */
  maxRetries?: number;
  parseResponse?: (content: string) => unknown;
  evaluateJudgment?: (args: { parsed: unknown; rawResponse: string }) => LLMJudgmentOutcome;
}

export interface AdapterInvokeArgs {
  model: ModelInvocationConfig;
  messages?: LLMMessage[];
  prompt?: string;
  params: LLMInferenceParams;
  signal?: AbortSignal;
}

export interface AdapterInvokeResult {
  content: string;
  rawResponse: unknown;
  finishReason?: string | null;
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
  };
}

export interface AdapterRequestLog {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface LLMAdapter {
  providerType: string;
  invoke(args: AdapterInvokeArgs): Promise<AdapterInvokeResult>;
  buildRequestLog?(args: AdapterInvokeArgs): AdapterRequestLog;
}

export type LLMJudgmentStatus = 'correct' | 'incorrect' | 'parse_error' | 'judge_error';

export interface LLMRunResultRecord {
  id: string;
  projectId: string;
  source: LLMSource;
  sourceId: string;
  releaseVariantId?: string | null;
  promptVersionId: string;
  modelId: string;
  sampleId?: string | null;
  externalId?: string | null;
  renderedPrompt: unknown;
  inputVariables?: unknown;
  rawResponse?: string | null;
  parsedOutput?: unknown;
  decisionOutput?: string | null;
  expectedOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: LLMJudgmentStatus | null;
  status: LLMRunStatus;
  errorClass?: string | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costEstimate?: number | null;
  attempt: number;
  dbosWorkflowId?: string | null;
  bullmqJobId?: string | null;
  // 优化 LLM 调用专用,见 RunResultContext.roundIndex 注释。
  roundIndex?: number | null;
}

export interface LLMRunResultWriter {
  writeRunResult(record: LLMRunResultRecord): Promise<void>;
}

export interface RateLimiterLike {
  acquire(args: {
    modelId: string;
    estimatedTokens: number;
    limits: {
      rpmLimit: number;
      tpmLimit: number;
      concurrencyLimit: number;
    };
  }): Promise<void>;
  release(args: { modelId: string }): Promise<void>;
}

export interface LLMCallLogger {
  debug?(payload: Record<string, unknown>, message: string): void;
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface InvokeLLMDependencies {
  limiter: RateLimiterLike;
  logger: LLMCallLogger;
  runResultWriter?: LLMRunResultWriter;
  adapters?: LLMAdapter[];
  now?: () => number;
}

export interface InvokeLLMResult {
  runResultId?: string;
  content: string;
  rawResponse: unknown;
  parsed?: unknown;
  decisionOutput?: string | null;
  isCorrect?: boolean | null;
  judgmentStatus?: LLMJudgmentStatus | null;
  finishReason?: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  costEstimate: number;
  durationMs: number;
}

export interface ModelConnectivityProbeArgs {
  model: ModelInvocationConfig;
  requestId?: string;
  timeoutMs?: number;
}

export interface ModelConnectivityProbeResult {
  ok: boolean;
  modelId: string;
  providerType: string;
  providerModelId: string;
  endpoint: string;
  durationMs: number;
  checkedAt: string;
  responsePreview?: string;
  errorClass?: string;
  errorMessage?: string;
  httpStatus?: number;
  providerErrorBody?: string;
}
