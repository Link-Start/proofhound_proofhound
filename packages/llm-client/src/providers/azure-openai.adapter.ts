import type { LLMAdapter } from '../types';
import { parseOpenAIResponse, toOpenAIRequestBody } from './openai.adapter';

const DEFAULT_AZURE_API_VERSION = '2024-10-21';

export const azureOpenAIAdapter: LLMAdapter = {
  providerType: 'azure-openai',
  buildRequestLog(args) {
    return {
      method: 'POST',
      url: azureChatCompletionsUrl(args.model.endpoint, args.model.providerModelId, args.params.apiVersion),
      body: toOpenAIRequestBody(args, false),
      headers: { 'Content-Type': 'application/json' },
    };
  },
  async invoke(args) {
    const response = await fetch(azureChatCompletionsUrl(args.model.endpoint, args.model.providerModelId, args.params.apiVersion), {
      method: 'POST',
      headers: {
        'api-key': args.model.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toOpenAIRequestBody(args, false)),
      signal: args.signal,
    });

    return parseOpenAIResponse(response);
  },
};

export function azureChatCompletionsUrl(endpoint: string, deployment: string, apiVersion?: string): string {
  const url = new URL(endpoint);
  const normalizedPath = url.pathname.replace(/\/+$/u, '');

  if (!normalizedPath.endsWith('/chat/completions')) {
    url.pathname = `${normalizedPath}/openai/deployments/${deployment}/chat/completions`;
  }

  url.searchParams.set('api-version', apiVersion ?? DEFAULT_AZURE_API_VERSION);

  return url.toString();
}
