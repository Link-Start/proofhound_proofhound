// Token 预算工具 — 防止单次 LLM 调用 input 溢出
// 估算口径与 packages/llm-client/src/token-estimate.ts 一致（4 字符/token 粗估）
import { estimateLLMTokens, estimateTextTokens } from '@proofhound/llm-client';

export interface BaselineEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// 估算「system + user + 预留输出」一次调用的 token 占用
export function estimateMessagesTokens(
  system: string,
  user: string,
  maxOutputTokens: number,
): BaselineEstimate {
  const u = estimateLLMTokens({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens: maxOutputTokens,
  });
  return { inputTokens: u.inputTokens, outputTokens: u.outputTokens, totalTokens: u.totalTokens };
}

// 计算样本预算 = 总输入预算 - baseline；下限 0
export function computeSampleBudget(
  maxInputTokensPerBatch: number,
  baselineInputTokens: number,
): number {
  return Math.max(0, maxInputTokensPerBatch - baselineInputTokens);
}

export interface FitSamplesResult<T> {
  fitted: T[];
  dropped: T[];
  estimatedTokens: number;
}

// 按样本估算 token 逐条 fit；至少保留 minSamples 条（即使超预算 — 让上层决定是否再截字段）
export function fitSamplesToBudget<T>(
  samples: T[],
  tokenBudget: number,
  minSamples = 1,
): FitSamplesResult<T> {
  const fitted: T[] = [];
  const dropped: T[] = [];
  let used = 0;
  for (const sample of samples) {
    const tokens = estimateTextTokens(sample);
    const wouldExceed = used + tokens > tokenBudget;
    if (fitted.length >= minSamples && wouldExceed) {
      dropped.push(sample);
      continue;
    }
    fitted.push(sample);
    used += tokens;
  }
  return { fitted, dropped, estimatedTokens: used };
}

// 字符串字段递归截断 — 用于"一条样本本身就超 budget"的极端情况
export const TRUNCATION_MARKER = '…[truncated]';

export function truncateStringFields<T>(value: T, maxChars: number, marker = TRUNCATION_MARKER): T {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return (value.length > maxChars ? value.slice(0, maxChars) + marker : value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((x) => truncateStringFields(x, maxChars, marker)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateStringFields(v, maxChars, marker);
    }
    return out as unknown as T;
  }
  return value;
}

// 截断单段长文本，保头部 + 尾部（中间用 marker 标记）— 适合 errorAnalysisText 这种长摘要
export function truncateLongText(text: string, maxChars: number, marker = TRUNCATION_MARKER): string {
  if (!text || text.length <= maxChars) return text;
  // 头部 70% + 尾部 30%；中间标 marker
  const headLen = Math.floor((maxChars - marker.length) * 0.7);
  const tailLen = maxChars - marker.length - headLen;
  return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
}

// 把对象内所有字符串字段限到 maxCharsPerField 之内；用于 summarize batches 降级
export function truncateAllStringFieldsInObject<T>(obj: T, maxCharsPerField: number): T {
  return truncateStringFields(obj, maxCharsPerField);
}

// 把数字 token 转换为可读字符数（仅用于日志友好展示）
export function tokensToChars(tokens: number): number {
  return tokens * 4;
}

// 工具：把样本/对象估成 token 数（封装 estimateTextTokens 暴露统一入口）
export function estimateTokens(value: unknown): number {
  return estimateTextTokens(value);
}
