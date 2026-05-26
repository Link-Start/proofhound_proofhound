// Per-model pricing + cost calculation
// See docs/specs/21-models.md

export interface TokenUsage {
  inputTokens?: number | null;
  outputTokens?: number | null;
}

export interface ModelPricing {
  inputTokenPricePerMillion: number | string;
  outputTokenPricePerMillion: number | string;
}

export function estimateCostFromTokenUsage(usage: TokenUsage, pricing: ModelPricing): number {
  const inputTokens = normalizeTokenCount(usage.inputTokens);
  const outputTokens = normalizeTokenCount(usage.outputTokens);
  const inputPrice = normalizePrice(pricing.inputTokenPricePerMillion);
  const outputPrice = normalizePrice(pricing.outputTokenPricePerMillion);

  return roundCost((inputTokens / 1_000_000) * inputPrice + (outputTokens / 1_000_000) * outputPrice);
}

function normalizeTokenCount(value: number | null | undefined) {
  if (value === null || value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('token count must be a nonnegative finite number');
  }
  return value;
}

function normalizePrice(value: number | string) {
  const normalized = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error('model token price must be a nonnegative finite number');
  }
  return normalized;
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
