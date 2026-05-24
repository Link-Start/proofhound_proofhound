import { randomBytes } from 'node:crypto';
import { encryptApiKey } from '@proofhound/crypto';
import type { DbClient } from '@proofhound/db';
import type { ModelInvocationConfig } from '@proofhound/llm-client';
import { describe, expect, it } from 'vitest';
import { applyExperimentLimits, loadModelInvocationConfig } from '../llm-runner';
import { createModelSecretResolver } from '../model-secret';

const ENCRYPTION_KEY = randomBytes(32).toString('base64');

const activeModel = {
  id: '11111111-1111-1111-1111-111111111111',
  providerType: 'openai',
  providerModelId: 'gpt-test',
  endpoint: 'https://llm.example.test/v1',
  apiKeyEncrypted: encryptApiKey('test-key', ENCRYPTION_KEY),
  isActive: true,
  rpmLimit: 60,
  tpmLimit: 1000,
  concurrencyLimit: 2,
  inputTokenPricePerMillion: '1.5',
  outputTokenPricePerMillion: '3.5',
  capabilities: { image: 'both' },
  extraBody: { top_k: 40 },
};

describe('loadModelInvocationConfig', () => {
  it('loads an active model and decrypts its api key via @proofhound/crypto', async () => {
    const config = await loadModelInvocationConfig(
      {
        db: fakeDb(activeModel),
        modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
      },
      activeModel.id,
    );

    expect(config).toEqual(
      expect.objectContaining({
        id: activeModel.id,
        providerType: 'openai',
        providerModelId: 'gpt-test',
        apiKey: 'test-key',
        capabilities: { image: 'both' },
        extraBody: { top_k: 40 },
      }),
    );
  });

  it('rejects missing or inactive models as validation errors', async () => {
    await expect(
      loadModelInvocationConfig(
        {
          db: fakeDb({ ...activeModel, isActive: false }),
          modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
        },
        activeModel.id,
      ),
    ).rejects.toMatchObject({ name: 'ValidationError' });

    await expect(
      loadModelInvocationConfig(
        {
          db: fakeDb(undefined),
          modelSecretResolver: createModelSecretResolver({ encryptionKey: ENCRYPTION_KEY }),
        },
        activeModel.id,
      ),
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });
});

function fakeDb(row: typeof activeModel | undefined): DbClient {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
  } as unknown as DbClient;
}

describe('applyExperimentLimits — 实验级与模型级取 min', () => {
  const base: ModelInvocationConfig = {
    id: 'm-1',
    providerType: 'openai',
    providerModelId: 'gpt-test',
    endpoint: 'https://x',
    apiKey: 'k',
    capabilities: { image: 'none' },
    rpmLimit: 100,
    tpmLimit: 10_000,
    concurrencyLimit: 8,
    inputTokenPricePerMillion: 0,
    outputTokenPricePerMillion: 0,
  };

  it('payload.limits 为 undefined → 原 model 不变', () => {
    expect(applyExperimentLimits(base, undefined)).toEqual(base);
  });

  it('payload.limits 完整 → 三字段独立取 min', () => {
    const eff = applyExperimentLimits(base, { rpmLimit: 10, tpmLimit: 5000, concurrency: 2 });
    expect(eff.rpmLimit).toBe(10);
    expect(eff.tpmLimit).toBe(5000);
    expect(eff.concurrencyLimit).toBe(2);
  });

  it('实验级 > 模型级 → 仍取模型级（self-throttle 只能向下）', () => {
    const eff = applyExperimentLimits(base, { rpmLimit: 500, tpmLimit: 100_000, concurrency: 99 });
    expect(eff.rpmLimit).toBe(100);
    expect(eff.tpmLimit).toBe(10_000);
    expect(eff.concurrencyLimit).toBe(8);
  });

  it('只填部分字段 → 其它字段回退到模型级', () => {
    const eff = applyExperimentLimits(base, { rpmLimit: 10 });
    expect(eff.rpmLimit).toBe(10);
    expect(eff.tpmLimit).toBe(10_000);
    expect(eff.concurrencyLimit).toBe(8);
  });
});
