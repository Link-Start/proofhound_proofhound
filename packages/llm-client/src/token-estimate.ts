import type { LLMMessage } from './types';

// Input / output token estimation — shared between pre-rate-limit and cost estimation
export interface EstimatedTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export function estimateTextTokens(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateLLMTokens(args: {
  messages?: LLMMessage[];
  prompt?: string;
  tools?: unknown;
  responseFormat?: unknown;
  maxTokens?: number;
}): EstimatedTokenUsage {
  const inputTokens =
    estimateTextTokens(args.prompt) +
    estimateTextTokens(args.messages ?? []) +
    estimateTextTokens(args.tools) +
    estimateTextTokens(args.responseFormat);
  const outputTokens = Math.max(0, Math.ceil(args.maxTokens ?? 0));

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}
