import { describe, expect, it } from 'vitest';
import { anthropicAdapter } from './anthropic.adapter';
import type { AdapterInvokeArgs } from '../types';

function baseArgs(providerModelId: string, extraBody: Record<string, unknown> = {}): AdapterInvokeArgs {
  return {
    model: {
      id: '11111111-1111-1111-1111-111111111111',
      providerType: 'anthropic',
      providerModelId,
      endpoint: 'https://api.anthropic.com',
      apiKey: 'secret',
      rpmLimit: 60,
      tpmLimit: 1000,
      concurrencyLimit: 2,
      autoConcurrency: false,
      inputTokenPricePerMillion: 0,
      outputTokenPricePerMillion: 0,
      extraBody,
    },
    messages: [{ role: 'user', content: 'ping' }],
    params: { temperature: 0, topP: 0.9, maxTokens: 8 },
  };
}

describe('anthropicAdapter', () => {
  it('omits sampling parameters for Claude Opus 4.7 request bodies', () => {
    const log = anthropicAdapter.buildRequestLog?.(
      baseArgs('claude-opus-4-7', {
        top_k: 40,
        thinking: { type: 'adaptive' },
        temperature: 1,
        top_p: 0.8,
      }),
    );

    expect(log?.body).toMatchObject({
      model: 'claude-opus-4-7',
      max_tokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
      thinking: { type: 'adaptive' },
    });
    expect(log?.body).not.toHaveProperty('temperature');
    expect(log?.body).not.toHaveProperty('top_p');
    expect(log?.body).not.toHaveProperty('top_k');
  });

  it('keeps sampling parameters for older Anthropic models', () => {
    const log = anthropicAdapter.buildRequestLog?.(
      baseArgs('claude-3-5-sonnet-20241022', { top_k: 40 }),
    );

    expect(log?.body).toMatchObject({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8,
      temperature: 0,
      top_p: 0.9,
      top_k: 40,
    });
  });

  it('does not treat dated Claude Opus 4 snapshots as the Opus 4.7 family', () => {
    const log = anthropicAdapter.buildRequestLog?.(baseArgs('claude-opus-4-20250514'));

    expect(log?.body).toMatchObject({
      model: 'claude-opus-4-20250514',
      temperature: 0,
      top_p: 0.9,
    });
  });
});
