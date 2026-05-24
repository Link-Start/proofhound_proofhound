import { describe, expect, it } from 'vitest';
import { estimateCostFromTokenUsage } from './cost';

describe('estimateCostFromTokenUsage', () => {
  it('calculates input and output token cost from per-million prices', () => {
    expect(
      estimateCostFromTokenUsage(
        { inputTokens: 250_000, outputTokens: 50_000 },
        { inputTokenPricePerMillion: 2.5, outputTokenPricePerMillion: 10 },
      ),
    ).toBe(1.125);
  });

  it('treats missing usage as zero cost inputs', () => {
    expect(
      estimateCostFromTokenUsage(
        { inputTokens: null, outputTokens: undefined },
        { inputTokenPricePerMillion: '2.5', outputTokenPricePerMillion: '10' },
      ),
    ).toBe(0);
  });

  it('rejects negative token counts and prices', () => {
    expect(() =>
      estimateCostFromTokenUsage(
        { inputTokens: -1, outputTokens: 0 },
        { inputTokenPricePerMillion: 2.5, outputTokenPricePerMillion: 10 },
      ),
    ).toThrow('token count');

    expect(() =>
      estimateCostFromTokenUsage(
        { inputTokens: 1, outputTokens: 0 },
        { inputTokenPricePerMillion: -2.5, outputTokenPricePerMillion: 10 },
      ),
    ).toThrow('price');
  });
});
