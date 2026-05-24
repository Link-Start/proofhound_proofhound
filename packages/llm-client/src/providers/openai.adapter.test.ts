import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatCompletionsUrl, openAIAdapter } from './openai.adapter';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chatCompletionsUrl', () => {
  it('uses versioned OpenAI-compatible API roots without injecting v1 again', () => {
    expect(chatCompletionsUrl('https://qianfan.baidubce.com/v2')).toBe(
      'https://qianfan.baidubce.com/v2/chat/completions',
    );
    expect(chatCompletionsUrl('https://qianfan.baidubce.com/v2/')).toBe(
      'https://qianfan.baidubce.com/v2/chat/completions',
    );
  });

  it('keeps full chat completions URLs unchanged', () => {
    expect(chatCompletionsUrl('https://qianfan.baidubce.com/v2/chat/completions')).toBe(
      'https://qianfan.baidubce.com/v2/chat/completions',
    );
    expect(chatCompletionsUrl('https://gateway.example.test/openai/v1/chat/completions?trace=1')).toBe(
      'https://gateway.example.test/openai/v1/chat/completions?trace=1',
    );
  });

  it('keeps the plain host fallback compatible with OpenAI v1 defaults', () => {
    expect(chatCompletionsUrl('https://api.openai.com')).toBe('https://api.openai.com/v1/chat/completions');
  });

  it('preserves opaque gateway paths by appending the OpenAI v1 route', () => {
    expect(chatCompletionsUrl('https://gateway.example.test/llm')).toBe(
      'https://gateway.example.test/llm/v1/chat/completions',
    );
  });

  it('supports OpenAI-compatible roots that use a named openai path', () => {
    expect(chatCompletionsUrl('https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
  });

  it('sends Qianfan v2 requests to the chat completions route', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'pong' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await openAIAdapter.invoke({
      model: {
        id: '11111111-1111-1111-1111-111111111111',
        providerType: 'openai',
        providerModelId: 'qwen3-next-80b-a3b-instruct',
        endpoint: 'https://qianfan.baidubce.com/v2',
        apiKey: 'secret',
        rpmLimit: 60,
        tpmLimit: 1000,
        concurrencyLimit: 2,
        inputTokenPricePerMillion: 0,
        outputTokenPricePerMillion: 0,
      },
      messages: [{ role: 'user', content: 'ping' }],
      params: { temperature: 0, maxTokens: 8 },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qianfan.baidubce.com/v2/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reports the resolved URL in OpenAI-compatible request logs', () => {
    expect(
      openAIAdapter.buildRequestLog?.({
        model: {
          id: '11111111-1111-1111-1111-111111111111',
          providerType: 'openai',
          providerModelId: 'qwen3-next-80b-a3b-instruct',
          endpoint: 'https://qianfan.baidubce.com/v2',
          apiKey: 'secret',
          rpmLimit: 60,
          tpmLimit: 1000,
          concurrencyLimit: 2,
          inputTokenPricePerMillion: 0,
          outputTokenPricePerMillion: 0,
        },
        messages: [{ role: 'user', content: 'ping' }],
        params: { temperature: 0, maxTokens: 8 },
      }),
    ).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: 'https://qianfan.baidubce.com/v2/chat/completions',
      }),
    );
  });

  it('merges model extraBody into OpenAI-compatible request bodies without overriding core fields', () => {
    const log = openAIAdapter.buildRequestLog?.({
      model: {
        id: '11111111-1111-1111-1111-111111111111',
        providerType: 'openai',
        providerModelId: 'qwen3-next-80b-a3b-instruct',
        endpoint: 'https://qianfan.baidubce.com/v2',
        apiKey: 'secret',
        rpmLimit: 60,
        tpmLimit: 1000,
        concurrencyLimit: 2,
        inputTokenPricePerMillion: 0,
        outputTokenPricePerMillion: 0,
        extraBody: {
          top_k: 40,
          messages: [{ role: 'user', content: 'bad override' }],
          model: 'bad-model',
        },
      },
      messages: [{ role: 'user', content: 'ping' }],
      params: { temperature: 0, maxTokens: 8 },
    });

    expect(log?.body).toMatchObject({
      top_k: 40,
      messages: [{ role: 'user', content: 'ping' }],
      model: 'qwen3-next-80b-a3b-instruct',
      temperature: 0,
      max_tokens: 8,
    });
  });
});
