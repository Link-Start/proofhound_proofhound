// Token-budget tools — prevent a single LLM call's input from overflowing
// The estimation calibration matches packages/llm-client/src/token-estimate.ts (rough 4 chars/token)
import { estimateLLMTokens, estimateTextTokens } from '@proofhound/llm-client';

export interface BaselineEstimate {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

// Estimate the per-call token footprint of "system + user + reserved output"
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

// Compute samples budget = total input budget - baseline; floor at 0
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

// Fit samples one by one by estimated tokens; keep at least minSamples (even if over budget — let the upper layer decide whether to truncate fields further)
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

// Recursive string-field truncation — used in the extreme case where "a single sample exceeds the budget"
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

// Truncate a single long text, keeping head + tail (middle marked with marker) — suited for long summaries like errorAnalysisText
export function truncateLongText(text: string, maxChars: number, marker = TRUNCATION_MARKER): string {
  if (!text || text.length <= maxChars) return text;
  // Head 70% + tail 30%; marker in the middle
  const headLen = Math.floor((maxChars - marker.length) * 0.7);
  const tailLen = maxChars - marker.length - headLen;
  return text.slice(0, headLen) + marker + text.slice(text.length - tailLen);
}

// Limit all string fields in an object to maxCharsPerField — used for summarize batches degradation
export function truncateAllStringFieldsInObject<T>(obj: T, maxCharsPerField: number): T {
  return truncateStringFields(obj, maxCharsPerField);
}

// Convert numeric tokens to readable char counts (only for log-friendly display)
export function tokensToChars(tokens: number): number {
  return tokens * 4;
}

// Utility: estimate sample/object tokens (wraps estimateTextTokens, exposing a unified entrypoint)
export function estimateTokens(value: unknown): number {
  return estimateTextTokens(value);
}
