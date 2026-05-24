import { LLMAdapterHttpError } from './openai.adapter';
import type { AdapterInvokeResult, LLMAdapter, LLMInferenceParams, LLMMessage } from '../types';

const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_SAMPLING_PARAM_KEYS = ['temperature', 'top_p', 'top_k'] as const;

export const anthropicAdapter: LLMAdapter = {
  providerType: 'anthropic',
  buildRequestLog(args) {
    return {
      method: 'POST',
      url: messagesUrl(args.model.endpoint),
      body: toAnthropicRequestBody(args),
      headers: {
        'anthropic-version': args.params.apiVersion ?? DEFAULT_ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
    };
  },
  async invoke(args) {
    const response = await fetch(messagesUrl(args.model.endpoint), {
      method: 'POST',
      headers: {
        'x-api-key': args.model.apiKey,
        'anthropic-version': args.params.apiVersion ?? DEFAULT_ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toAnthropicRequestBody(args)),
      signal: args.signal,
    });

    return parseAnthropicResponse(response);
  },
};

function toAnthropicRequestBody(args: Parameters<LLMAdapter['invoke']>[0]): Record<string, unknown> {
  const shouldOmitSampling = shouldOmitAnthropicSamplingParameters(args.model.providerModelId);
  const body: Record<string, unknown> = {
    ...(args.model.extraBody ?? {}),
    model: args.model.providerModelId,
    max_tokens: args.params.maxTokens ?? 1024,
    messages: userMessages(args.messages, args.prompt),
  };

  if (!shouldOmitSampling && args.params.temperature !== undefined) body['temperature'] = args.params.temperature;
  if (!shouldOmitSampling && args.params.topP !== undefined) body['top_p'] = args.params.topP;
  const system = systemPrompt(args.messages);
  if (system !== undefined) body['system'] = system;
  if (args.params.tools !== undefined) body['tools'] = args.params.tools;
  if (shouldOmitSampling) deleteAnthropicSamplingParameters(body);

  return body;
}

export function normalizeAnthropicInferenceParams(
  providerModelId: string,
  params: LLMInferenceParams,
): LLMInferenceParams {
  if (!shouldOmitAnthropicSamplingParameters(providerModelId)) return params;

  const { temperature: _temperature, topP: _topP, ...rest } = params;
  return rest;
}

export function shouldOmitAnthropicSamplingParameters(providerModelId: string): boolean {
  const version = parseClaudeOpusVersion(providerModelId);
  if (!version) return false;

  return version.major > 4 || (version.major === 4 && version.minor !== null && version.minor >= 7);
}

function deleteAnthropicSamplingParameters(body: Record<string, unknown>): void {
  for (const key of ANTHROPIC_SAMPLING_PARAM_KEYS) {
    delete body[key];
  }
}

function parseClaudeOpusVersion(providerModelId: string): { major: number; minor: number | null } | null {
  const match = /(?:^|[.:/])claude-opus-(\d+)(?:-(\d+))?(?:$|-)/u.exec(providerModelId.trim().toLowerCase());
  if (!match) return null;

  const major = Number(match[1]);
  const minorSegment = match[2];
  const minor =
    minorSegment === undefined || /^\d{8}$/u.test(minorSegment) ? null : Number(minorSegment);

  if (!Number.isSafeInteger(major) || (minor !== null && !Number.isSafeInteger(minor))) return null;
  return { major, minor };
}

async function parseAnthropicResponse(response: Response): Promise<AdapterInvokeResult> {
  const bodyText = await response.text();
  const body = parseJsonBody(bodyText);

  if (!response.ok) {
    throw new LLMAdapterHttpError('anthropic request failed', response.status, bodyText);
  }

  const content = Array.isArray(body['content'])
    ? body['content']
        .map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : ''))
        .join('')
    : '';
  const usage = isRecord(body['usage']) ? body['usage'] : {};

  return {
    content,
    rawResponse: body,
    finishReason: typeof body['stop_reason'] === 'string' ? body['stop_reason'] : null,
    usage: {
      inputTokens: numberOrNull(usage['input_tokens']),
      outputTokens: numberOrNull(usage['output_tokens']),
    },
  };
}

function messagesUrl(endpoint: string): string {
  const url = new URL(endpoint);
  const normalizedPath = url.pathname.replace(/\/+$/u, '');
  if (!normalizedPath.endsWith('/messages')) {
    url.pathname = normalizedPath.endsWith('/v1') ? `${normalizedPath}/messages` : `${normalizedPath}/v1/messages`;
  }
  return url.toString();
}

function systemPrompt(messages?: LLMMessage[]): string | undefined {
  const systemMessages = messages?.filter((message) => message.role === 'system') ?? [];
  if (systemMessages.length === 0) return undefined;
  return systemMessages.map((message) => stringifyContent(message.content)).join('\n\n');
}

function userMessages(messages?: LLMMessage[], prompt?: string): LLMMessage[] {
  const filtered = messages?.filter((message) => message.role !== 'system') ?? [];
  if (filtered.length > 0) return filtered;
  return [{ role: 'user', content: prompt ?? '' }];
}

function stringifyContent(content: LLMMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function parseJsonBody(bodyText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(bodyText) as unknown;
    return isRecord(parsed) ? parsed : { raw: parsed };
  } catch {
    return { raw: bodyText };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
