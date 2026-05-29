import { describe, expect, it } from 'vitest';
import { MODEL_DEFAULT_CONCURRENCY_LIMIT, createProjectModelSchema, projectModelListItemSchema } from './model.dto';

const baseCreateInput = {
  name: 'GPT',
  providerType: 'openai',
  providerModelId: 'gpt-4o',
  endpoint: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  contextWindowTokens: 128000,
  rpm: { limit: 60 },
  tpm: { limit: 100000 },
  pricing: { inputPerMillion: 0, outputPerMillion: 0 },
  capabilities: { image: 'none' },
};

describe('model DTO quota limits', () => {
  it('allows -1 for RPM and TPM and defaults omitted concurrency to 20', () => {
    const parsed = createProjectModelSchema.parse({
      ...baseCreateInput,
      rpm: { limit: -1 },
      tpm: { limit: -1 },
    });

    expect(parsed.rpm.limit).toBe(-1);
    expect(parsed.tpm.limit).toBe(-1);
    expect(parsed.concurrency.limit).toBe(MODEL_DEFAULT_CONCURRENCY_LIMIT);
  });

  it('rejects zero RPM/TPM and non-positive or oversized concurrency', () => {
    expect(createProjectModelSchema.safeParse({ ...baseCreateInput, rpm: { limit: 0 } }).success).toBe(false);
    expect(createProjectModelSchema.safeParse({ ...baseCreateInput, tpm: { limit: 0 } }).success).toBe(false);
    expect(
      createProjectModelSchema.safeParse({
        ...baseCreateInput,
        concurrency: { limit: 0 },
      }).success,
    ).toBe(false);
    expect(
      createProjectModelSchema.safeParse({
        ...baseCreateInput,
        concurrency: { limit: 1000 },
      }).success,
    ).toBe(false);
  });

  it('accepts provider-specific extra body JSON objects', () => {
    const parsed = createProjectModelSchema.parse({
      ...baseCreateInput,
      extraBody: { top_k: 40, reasoning_effort: 'low' },
    });

    expect(parsed.extraBody).toEqual({ top_k: 40, reasoning_effort: 'low' });
    expect(createProjectModelSchema.safeParse({ ...baseCreateInput, extraBody: [] }).success).toBe(false);
  });

  it('accepts disabled status when creating a model draft', () => {
    const parsed = createProjectModelSchema.parse({
      ...baseCreateInput,
      status: 'disabled',
    });

    expect(parsed.status).toBe('disabled');
    expect(createProjectModelSchema.safeParse({ ...baseCreateInput, status: 'testing' }).success).toBe(false);
  });

  it('accepts an initial probe outcome on create payloads', () => {
    const parsed = createProjectModelSchema.parse({
      ...baseCreateInput,
      initialProbe: {
        status: 'failed',
        probedAt: '2026-05-18T01:00:00.000Z',
        error: 'invalid_api_key',
      },
    });

    expect(parsed.initialProbe).toEqual({
      status: 'failed',
      probedAt: '2026-05-18T01:00:00.000Z',
      error: 'invalid_api_key',
    });
    expect(
      createProjectModelSchema.safeParse({
        ...baseCreateInput,
        initialProbe: { status: 'pending', probedAt: '2026-05-18T01:00:00.000Z', error: null },
      }).success,
    ).toBe(false);
  });

  it('keeps concurrency bounded in list response DTOs', () => {
    const baseListItem = {
      id: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000003',
      name: 'GPT',
      providerType: 'openai',
      providerModelId: 'gpt-4o',
      endpoint: 'https://api.openai.com/v1',
      contextWindowTokens: 128000,
      credentialTail: 'test',
      status: 'enabled',
      probeStatus: 'pending',
      lastProbedAt: null,
      lastProbeError: null,
      rpm: { limit: -1, usage: 0, current: 120 },
      tpm: { limit: -1, usage: 0, current: 10000 },
      concurrency: { limit: 999, usage: 0, current: 0 },
      autoConcurrency: true,
      pricing: { inputPerMillion: 0, outputPerMillion: 0 },
      capabilities: { image: 'none' },
      createdAt: '2026-05-18T00:00:00.000Z',
      updatedAt: '2026-05-18T00:00:00.000Z',
      createdBy: '00000000-0000-4000-8000-000000000002',
      createdByDisplayName: null,
      references: 0,
    };

    expect(projectModelListItemSchema.safeParse(baseListItem).success).toBe(true);
    expect(projectModelListItemSchema.safeParse({ ...baseListItem, concurrency: { limit: -1 } }).success).toBe(false);
  });
});
