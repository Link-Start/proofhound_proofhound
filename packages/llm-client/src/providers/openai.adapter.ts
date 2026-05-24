import type { AdapterInvokeArgs, AdapterInvokeResult, LLMAdapter } from '../types';

export const openAIAdapter: LLMAdapter = {
  providerType: 'openai',
  buildRequestLog(args) {
    return {
      method: 'POST',
      url: chatCompletionsUrl(args.model.endpoint),
      body: toOpenAIRequestBody(args, true),
      headers: { 'Content-Type': 'application/json' },
    };
  },
  async invoke(args) {
    const response = await fetch(chatCompletionsUrl(args.model.endpoint), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.model.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toOpenAIRequestBody(args, true)),
      signal: args.signal,
    });

    return parseOpenAIResponse(response);
  },
};

export async function parseOpenAIResponse(response: Response): Promise<AdapterInvokeResult> {
  const bodyText = await response.text();
  const body = parseJsonBody(bodyText);

  if (!response.ok) {
    throw new LLMAdapterHttpError('openai request failed', response.status, bodyText);
  }

  const choices = Array.isArray(body['choices']) ? body['choices'] : [];
  const choice = isRecord(choices[0]) ? choices[0] : undefined;
  const message = isRecord(choice?.['message']) ? choice['message'] : undefined;
  const content = message?.['content'] ?? choice?.['text'] ?? '';
  const usage = isRecord(body['usage']) ? body['usage'] : {};

  return {
    content: normalizeContent(content),
    rawResponse: body,
    finishReason: typeof choice?.['finish_reason'] === 'string' ? choice['finish_reason'] : null,
    usage: {
      inputTokens: numberOrNull(usage['prompt_tokens'] ?? usage['input_tokens']),
      outputTokens: numberOrNull(usage['completion_tokens'] ?? usage['output_tokens']),
    },
  };
}

export function toOpenAIRequestBody(args: AdapterInvokeArgs, includeModel: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ...(args.model.extraBody ?? {}),
    messages: args.messages ?? [{ role: 'user', content: args.prompt ?? '' }],
  };

  if (includeModel) body['model'] = args.model.providerModelId;
  if (args.params.temperature !== undefined) body['temperature'] = args.params.temperature;
  if (args.params.maxTokens !== undefined) body['max_tokens'] = args.params.maxTokens;
  if (args.params.topP !== undefined) body['top_p'] = args.params.topP;
  if (args.params.tools !== undefined) body['tools'] = args.params.tools;
  if (args.params.responseFormat !== undefined) body['response_format'] = args.params.responseFormat;

  return body;
}

export function chatCompletionsUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const normalizedPath = url.pathname.replace(/\/+$/u, '');

  if (normalizedPath.endsWith('/chat/completions')) {
    return url.toString();
  }

  url.pathname =
    normalizedPath !== '' && shouldAppendChatCompletionsDirectly(normalizedPath)
      ? `${normalizedPath}/chat/completions`
      : `${normalizedPath}/v1/chat/completions`;

  return url.toString();
}

function shouldAppendChatCompletionsDirectly(pathname: string): boolean {
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments.at(-1)?.toLowerCase() ?? '';

  return isVersionedApiRootSegment(lastSegment) || lastSegment === 'openai';
}

function isVersionedApiRootSegment(segment: string): boolean {
  return /^v\d+(?:(?:alpha|beta|preview)\d*)?$/u.test(segment);
}

export class LLMAdapterHttpError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly providerErrorBody: string,
  ) {
    super(message);
    this.name = 'LLMAdapterHttpError';
  }
}

function parseJsonBody(bodyText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return isRecord(parsed) ? parsed : { raw: parsed };
  } catch {
    return { raw: bodyText };
  }
}

function normalizeContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : isRecord(part) && typeof part['text'] === 'string' ? part['text'] : JSON.stringify(part)))
      .join('');
  }
  return content === null || content === undefined ? '' : JSON.stringify(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
